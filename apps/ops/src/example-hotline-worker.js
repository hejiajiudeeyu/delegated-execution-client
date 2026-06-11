#!/usr/bin/env node

import process from "node:process";

import { summarizeExampleText } from "./example-hotline.js";

let raw = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});

process.stdin.on("end", () => {
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const text = payload?.input?.text ?? payload?.payload?.text ?? "";
    const diagnostics = payload?.input?.diagnostics ?? payload?.payload?.diagnostics ?? {};
    const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
    const links = Array.isArray(diagnostics?.links) ? diagnostics.links : [];
    const nextSteps = Array.isArray(diagnostics?.next_steps)
      ? diagnostics.next_steps
      : ["Run delexec-ops status.", "Run delexec-ops debug-snapshot if a check fails."];
    const failing = checks.filter((item) => item?.status === "fail").length;
    const warnings = checks.filter((item) => item?.status === "warn").length;
    const summary =
      failing > 0
        ? `Local delegated-execution workspace has ${failing} failing check(s).`
        : warnings > 0
          ? `Local delegated-execution workspace is callable, with ${warnings} warning check(s).`
          : "Local delegated-execution workspace is ready for a first trial call.";
    process.stdout.write(
      JSON.stringify({
        status: "ok",
        output: {
          summary: text ? `${summary} Note: ${summarizeExampleText(text)}` : summary,
          checks,
          links,
          next_steps: nextSteps
        },
        schema_valid: true,
        usage: {
          tokens_in: String(text || "").trim() ? 1 : 0,
          tokens_out: Math.max(1, checks.length + links.length + nextSteps.length)
        }
      })
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: "error",
        error: {
          code: "HOTLINE_INVALID_INPUT",
          message: error instanceof Error ? error.message : "invalid_input",
          retryable: false
        },
        schema_valid: true,
        usage: {
          tokens_in: 0,
          tokens_out: 0
        }
      })
    );
  }
});
