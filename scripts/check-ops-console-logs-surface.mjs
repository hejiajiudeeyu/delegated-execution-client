#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RUNTIME_PAGE_PATH = path.join(ROOT, "apps/ops-console/src/pages/general/RuntimePage.tsx");
const HELP_PAGE_PATH = path.join(ROOT, "apps/ops-console/src/pages/help/HelpPage.tsx");

const REQUIRED_ROUTES = ["/general/runtime", "/help"];
const REQUIRED_API_CALLS = ["/runtime/logs", "/runtime/alerts"];
const REQUIRED_LOG_SERVICES = ["caller", "responder", "relay"];
const REQUIRED_LOG_CONTROLS = ["max_lines", "max_items", "filterText", "levelFilter", "logFile"];
const REQUIRED_HELP_COMMANDS = ["selfhost:logs"];
const REQUIRED_SAFETY_PATTERNS = [/secret/i, /不会输出 secret 值/i, /不会显示 secret 值/i];

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { json: false };
  for (const arg of args) {
    if (arg === "--") continue;
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

function missingNeedles(source, needles) {
  return needles.filter((needle) => !source.includes(needle));
}

function buildReport() {
  const runtimePage = readText(RUNTIME_PAGE_PATH);
  const helpPage = readText(HELP_PAGE_PATH);
  const combinedPages = `${runtimePage}\n${helpPage}`;
  const blockers = [];

  const missingApis = missingNeedles(runtimePage, REQUIRED_API_CALLS);
  if (missingApis.length) {
    blockers.push(`RuntimePage is missing log API calls: ${missingApis.join(", ")}`);
  }

  const missingServices = missingNeedles(runtimePage, REQUIRED_LOG_SERVICES);
  if (missingServices.length) {
    blockers.push(`RuntimePage is missing log services: ${missingServices.join(", ")}`);
  }

  const missingControls = missingNeedles(runtimePage, REQUIRED_LOG_CONTROLS);
  if (missingControls.length) {
    blockers.push(`RuntimePage is missing log controls or metadata: ${missingControls.join(", ")}`);
  }

  const missingHelpCommands = missingNeedles(helpPage, REQUIRED_HELP_COMMANDS);
  if (missingHelpCommands.length) {
    blockers.push(`HelpPage is missing log guidance commands: ${missingHelpCommands.join(", ")}`);
  }

  if (!helpPage.includes("Runtime 监控") || !helpPage.includes('to="/general/runtime"')) {
    blockers.push("HelpPage is missing deployability guidance to the Runtime page");
  }

  if (!REQUIRED_SAFETY_PATTERNS.some((pattern) => pattern.test(combinedPages))) {
    blockers.push("Runtime/Help pages are missing secret-safety copy for log guidance");
  }

  return {
    command: "check:ops-console-logs-surface",
    ok: blockers.length === 0,
    surface: "logs_guidance",
    owner_repo: "repos/client",
    required_routes: REQUIRED_ROUTES,
    required_api_calls: REQUIRED_API_CALLS,
    required_log_services: REQUIRED_LOG_SERVICES,
    required_log_controls: REQUIRED_LOG_CONTROLS,
    safety_notes: [
      "Runtime surface reads log tails and structured alerts from the client-owned console API.",
      "Runtime surface exposes log filtering, level filtering, and log file metadata without treating raw log lines as machine payload evidence.",
      "Help deployability guidance points operators to selfhost:logs and says Runtime/selfhost helpers do not expose secret values."
    ],
    files: [
      "apps/ops-console/src/pages/general/RuntimePage.tsx",
      "apps/ops-console/src/pages/help/HelpPage.tsx"
    ],
    blockers
  };
}

function printText(report) {
  console.log("Ops-console logs surface evidence");
  console.log("=================================");
  console.log(`surface=${report.surface}`);
  console.log(`ok=${report.ok}`);
  for (const route of report.required_routes) console.log(`route=${route}`);
  for (const apiPath of report.required_api_calls) console.log(`api=${apiPath}`);
  for (const service of report.required_log_services) console.log(`log_service=${service}`);
  for (const control of report.required_log_controls) console.log(`log_control=${control}`);
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
