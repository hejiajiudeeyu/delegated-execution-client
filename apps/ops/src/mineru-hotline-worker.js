#!/usr/bin/env node
//
// Reference process-adapter worker for a local MinerU PDF-parse hotline.
//
// Contract with the responder runtime: one JSON payload arrives on stdin, one
// JSON payload leaves on stdout, stderr is diagnostics. MinerU itself is
// chatty on both of its own streams, so its output is captured and never
// forwarded — a single stray progress bar on our stdout would make the whole
// result unparseable.
//
// The input PDF is taken from `input_artifacts` when the caller sent it
// through the artifact channel, and only falls back to inline base64 for
// local runs. That ordering is the point: a real document is far too large to
// ride inside the task envelope.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const MINERU_BIN = process.env.MINERU_BIN || "mineru";
const MINERU_BACKEND = process.env.MINERU_BACKEND || "pipeline";
const MINERU_METHOD = process.env.MINERU_METHOD || "auto";
const MINERU_MODEL_SOURCE = process.env.MINERU_MODEL_SOURCE || "local";
const MAX_OUTPUT_ARTIFACT_BYTES = Number(process.env.MINERU_MAX_OUTPUT_BYTES || 8 * 1024 * 1024);

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function fail(code, message, { retryable = false } = {}) {
  emit({
    status: "error",
    error: { code, message, retryable },
    schema_valid: true,
    usage: { tokens_in: 0, tokens_out: 0 }
  });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", reject);
  });
}

/**
 * Where the PDF comes from, in priority order. An input artifact is the real
 * path; inline base64 exists so a local run with no platform binding still
 * works, and is capped because anything big has no business in an envelope.
 */
function selectSourceDocument(payload) {
  const artifacts = Array.isArray(payload.input_artifacts) ? payload.input_artifacts : [];
  const pdf =
    artifacts.find((item) => (item?.media_type || "").includes("pdf")) ||
    artifacts.find((item) => /\.pdf$/i.test(item?.name || "")) ||
    artifacts[0] ||
    null;

  if (pdf?.content_base64) {
    return { name: pdf.name || "input.pdf", buffer: Buffer.from(pdf.content_base64, "base64"), origin: "artifact" };
  }

  const inline = payload?.input?.content_base64 || payload?.payload?.content_base64 || null;
  if (inline) {
    return { name: payload?.input?.name || "input.pdf", buffer: Buffer.from(inline, "base64"), origin: "inline" };
  }

  return null;
}

function runMineru({ pdfPath, outputDir, startPage, endPage, timeoutMs }) {
  return new Promise((resolve) => {
    const args = ["-p", pdfPath, "-o", outputDir, "-b", MINERU_BACKEND, "-m", MINERU_METHOD];
    if (Number.isInteger(startPage)) {
      args.push("-s", String(startPage));
    }
    if (Number.isInteger(endPage)) {
      args.push("-e", String(endPage));
    }

    const child = spawn(MINERU_BIN, args, {
      env: { ...process.env, MINERU_MODEL_SOURCE },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let killedForTimeout = false;
    // Captured, never forwarded: our stdout carries exactly one JSON payload.
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 64 * 1024) {
        stderr = stderr.slice(-64 * 1024);
      }
    });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            killedForTimeout = true;
            try {
              child.kill("SIGKILL");
            } catch {
              // already gone
            }
          }, timeoutMs)
        : null;

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: "MINERU_SPAWN_FAILED", message: error.message, retryable: false });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killedForTimeout) {
        resolve({ ok: false, code: "MINERU_TIMEOUT", message: "mineru exceeded its time budget", retryable: true });
        return;
      }
      if (code !== 0) {
        resolve({
          ok: false,
          code: "MINERU_EXITED",
          message: stderr.trim().split("\n").slice(-5).join("\n") || `mineru exited with code ${code}`,
          retryable: false
        });
        return;
      }
      resolve({ ok: true, stderr });
    });
  });
}

/**
 * MinerU writes to <outputDir>/<stem>/<method>/. The method directory is not
 * always the one we asked for (auto resolves to txt or ocr), so it is
 * discovered rather than assumed.
 */
function locateResult(outputDir, stem) {
  const stemDir = path.join(outputDir, stem);
  if (!fs.existsSync(stemDir)) {
    return null;
  }
  const candidates = fs
    .readdirSync(stemDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(stemDir, entry.name));

  for (const dir of candidates) {
    const markdown = path.join(dir, `${stem}.md`);
    if (fs.existsSync(markdown)) {
      return { dir, markdownPath: markdown, contentListPath: path.join(dir, `${stem}_content_list.json`) };
    }
  }
  return null;
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    fail("HOTLINE_INPUT_INVALID_JSON", "worker expects a single JSON payload on stdin");
    return;
  }

  const source = selectSourceDocument(payload);
  if (!source || source.buffer.length === 0) {
    fail(
      "MINERU_NO_INPUT_DOCUMENT",
      "no input document: send a PDF as an input artifact, or inline content_base64 for local runs"
    );
    return;
  }
  if (source.origin === "inline" && source.buffer.length > MAX_OUTPUT_ARTIFACT_BYTES) {
    fail("MINERU_INLINE_DOCUMENT_TOO_LARGE", "inline documents are capped; send it as an input artifact instead");
    return;
  }

  const constraints = payload.constraints || {};
  const hardTimeoutS = Number(constraints.hard_timeout_s || 0);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "delexec-mineru-"));
  const stem = "document";
  const pdfPath = path.join(workDir, `${stem}.pdf`);
  const outputDir = path.join(workDir, "out");

  try {
    fs.writeFileSync(pdfPath, source.buffer);
    fs.mkdirSync(outputDir, { recursive: true });

    const startedAt = Date.now();
    const run = await runMineru({
      pdfPath,
      outputDir,
      startPage: Number.isInteger(payload?.input?.start_page) ? payload.input.start_page : undefined,
      endPage: Number.isInteger(payload?.input?.end_page) ? payload.input.end_page : undefined,
      // Leave headroom under the runtime's own hard timeout so this worker
      // reports a clean MINERU_TIMEOUT instead of being SIGKILLed mid-write.
      timeoutMs: hardTimeoutS > 5 ? (hardTimeoutS - 5) * 1000 : 0
    });

    if (!run.ok) {
      fail(run.code, run.message, { retryable: run.retryable });
      return;
    }

    const located = locateResult(outputDir, stem);
    if (!located) {
      fail("MINERU_NO_OUTPUT", "mineru exited successfully but produced no markdown output");
      return;
    }

    const markdown = fs.readFileSync(located.markdownPath);
    if (markdown.length > MAX_OUTPUT_ARTIFACT_BYTES) {
      fail("MINERU_OUTPUT_TOO_LARGE", `parsed markdown exceeds ${MAX_OUTPUT_ARTIFACT_BYTES} bytes`);
      return;
    }

    let blockCount = null;
    try {
      const contentList = JSON.parse(fs.readFileSync(located.contentListPath, "utf8"));
      blockCount = Array.isArray(contentList) ? contentList.length : null;
    } catch {
      // The content list is a nicety; its absence does not invalidate the parse.
    }

    const images = [];
    const imagesDir = path.join(located.dir, "images");
    if (fs.existsSync(imagesDir)) {
      for (const name of fs.readdirSync(imagesDir).sort()) {
        const buffer = fs.readFileSync(path.join(imagesDir, name));
        images.push({
          name: `images/${name}`,
          media_type: name.endsWith(".png") ? "image/png" : "image/jpeg",
          content_base64: buffer.toString("base64")
        });
      }
    }

    const artifacts = [
      {
        artifact_id: "mineru_markdown",
        name: `${path.parse(source.name).name || "document"}.md`,
        media_type: "text/markdown",
        content_base64: markdown.toString("base64")
      },
      ...images
    ];
    const totalArtifactBytes = artifacts.reduce(
      (sum, item) => sum + Buffer.byteLength(item.content_base64, "base64"),
      0
    );
    if (totalArtifactBytes > MAX_OUTPUT_ARTIFACT_BYTES) {
      // Drop the images rather than fail the parse: the markdown is the result.
      artifacts.length = 1;
    }

    emit({
      status: "ok",
      output: {
        markdown_sha256: crypto.createHash("sha256").update(markdown).digest("hex"),
        markdown_bytes: markdown.length,
        markdown_preview: markdown.toString("utf8").slice(0, 500),
        block_count: blockCount,
        image_count: artifacts.length - 1,
        source_document: {
          name: source.name,
          origin: source.origin,
          bytes: source.buffer.length,
          sha256: crypto.createHash("sha256").update(source.buffer).digest("hex")
        },
        mineru: {
          backend: MINERU_BACKEND,
          method: MINERU_METHOD,
          model_source: MINERU_MODEL_SOURCE,
          elapsed_ms: Date.now() - startedAt
        }
      },
      artifacts,
      schema_valid: true,
      usage: { tokens_in: 0, tokens_out: 0 }
    });
  } catch (error) {
    fail("MINERU_WORKER_ERROR", error instanceof Error ? error.message : String(error));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail("MINERU_WORKER_ERROR", error instanceof Error ? error.message : String(error));
});
