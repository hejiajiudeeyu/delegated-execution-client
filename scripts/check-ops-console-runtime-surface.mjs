#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "apps/ops-console/src/App.tsx");
const RUNTIME_PAGE_PATH = path.join(ROOT, "apps/ops-console/src/pages/general/RuntimePage.tsx");

const REQUIRED_API_CALLS = ["/status", "/runtime/logs", "/runtime/alerts"];
const REQUIRED_RUNTIME_SERVICES = ["caller", "responder", "relay", "skill_adapter", "mcp_adapter"];
const REQUIRED_LOCAL_DEBUG_PATTERNS = [
  /本机调试路径/,
  /delexec-ops run-example/,
  /delexec-ops debug-snapshot/,
  /公网或 self-host 是后续发布路径/,
  /不把 self-host 当成本机闭环的前置步骤/
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { json: false };
  for (const arg of args) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      result.json = true;
      continue;
    }
    throw new Error(`unknown option ${arg}`);
  }
  return result;
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return "";
  }
}

function missingApiCalls(runtimePage) {
  return REQUIRED_API_CALLS.filter((apiPath) => !runtimePage.includes(apiPath));
}

function missingServices(runtimePage) {
  return REQUIRED_RUNTIME_SERVICES.filter((service) => !runtimePage.includes(service));
}

function buildReport() {
  const app = readText(APP_PATH);
  const runtimePage = readText(RUNTIME_PAGE_PATH);
  const blockers = [];

  if (!app.includes('path="general/runtime"') || !app.includes("RuntimePage")) {
    blockers.push("ops-console route /general/runtime is not wired to RuntimePage");
  }

  const missingApis = missingApiCalls(runtimePage);
  if (missingApis.length) {
    blockers.push(`RuntimePage is missing API calls: ${missingApis.join(", ")}`);
  }

  const missingRuntimeServices = missingServices(runtimePage);
  if (missingRuntimeServices.length) {
    blockers.push(`RuntimePage is missing runtime service cards: ${missingRuntimeServices.join(", ")}`);
  }

  const missingLocalDebugPatterns = REQUIRED_LOCAL_DEBUG_PATTERNS.filter((pattern) => !pattern.test(runtimePage));
  if (missingLocalDebugPatterns.length) {
    blockers.push("RuntimePage is missing local-first debug guidance");
  }

  return {
    command: "check:ops-console-runtime-surface",
    ok: blockers.length === 0,
    surface: "runtime_status",
    owner_repo: "repos/client",
    route: "/general/runtime",
    required_api_calls: REQUIRED_API_CALLS,
    required_runtime_services: REQUIRED_RUNTIME_SERVICES,
    safety_notes: [
      "Runtime surface reads status, log metadata, and structured alerts from the client-owned console API.",
      "Runtime surface starts with local debug commands before platform, public-stack, or self-host exposure.",
      "Runtime surface evidence stays at route, service, status, and log-metadata level without printing secret values."
    ],
    files: [
      "apps/ops-console/src/App.tsx",
      "apps/ops-console/src/pages/general/RuntimePage.tsx"
    ],
    blockers
  };
}

function printText(report) {
  console.log("Ops-console runtime surface evidence");
  console.log("====================================");
  console.log(`surface=${report.surface}`);
  console.log(`route=${report.route}`);
  console.log(`ok=${report.ok}`);
  for (const apiPath of report.required_api_calls) console.log(`api=${apiPath}`);
  for (const service of report.required_runtime_services) console.log(`service=${service}`);
  for (const note of report.safety_notes) console.log(`safety=${note}`);
  if (report.blockers.length) {
    console.log("\nBlockers:");
    for (const blocker of report.blockers) console.log(`- ${blocker}`);
  }
}

try {
  const args = parseArgs(process.argv);
  const report = buildReport();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
