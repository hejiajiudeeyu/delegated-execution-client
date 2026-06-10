#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, "apps/ops-console/src/App.tsx");
const PREFERENCES_PAGE_PATH = path.join(ROOT, "apps/ops-console/src/pages/caller/PreferencesPage.tsx");
const ACCESS_LISTS_PAGE_PATH = path.join(ROOT, "apps/ops-console/src/pages/caller/AccessListsPage.tsx");

const REQUIRED_ROUTES = ["/caller/preferences", "/caller/lists"];
const REQUIRED_API_CALLS = ["/caller/global-policy"];
const REQUIRED_POLICY_MODES = ["manual", "allow_listed", "allow_all"];
const REQUIRED_LIST_FIELDS = ["responderWhitelist", "hotlineWhitelist", "blocklist"];
const REQUIRED_SAFETY_PATTERNS = [/allow_all/i, /公开或团队部署/, /Blocklist/];

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
  const app = readText(APP_PATH);
  const preferencesPage = readText(PREFERENCES_PAGE_PATH);
  const accessListsPage = readText(ACCESS_LISTS_PAGE_PATH);
  const combinedPages = `${preferencesPage}\n${accessListsPage}`;
  const blockers = [];

  if (!app.includes('path="preferences"') || !app.includes("PreferencesPage")) {
    blockers.push("ops-console route /caller/preferences is not wired to PreferencesPage");
  }
  if (!app.includes('path="lists"') || !app.includes("AccessListsPage")) {
    blockers.push("ops-console route /caller/lists is not wired to AccessListsPage");
  }

  const missingApis = missingNeedles(combinedPages, REQUIRED_API_CALLS);
  if (missingApis.length) {
    blockers.push(`settings surfaces are missing API calls: ${missingApis.join(", ")}`);
  }

  const missingModes = missingNeedles(combinedPages, REQUIRED_POLICY_MODES);
  if (missingModes.length) {
    blockers.push(`settings surfaces are missing approval modes: ${missingModes.join(", ")}`);
  }

  const missingListFields = missingNeedles(combinedPages, REQUIRED_LIST_FIELDS);
  if (missingListFields.length) {
    blockers.push(`settings surfaces are missing policy list fields: ${missingListFields.join(", ")}`);
  }

  if (!preferencesPage.includes("describeModeChange") || !preferencesPage.includes("AlertDialog")) {
    blockers.push("PreferencesPage is missing guarded approval-mode change flow");
  }

  if (!REQUIRED_SAFETY_PATTERNS.every((pattern) => pattern.test(combinedPages))) {
    blockers.push("settings surfaces are missing allow_all and Blocklist safety copy");
  }

  return {
    command: "check:ops-console-settings-surface",
    ok: blockers.length === 0,
    surface: "settings_approval_policy",
    owner_repo: "repos/client",
    required_routes: REQUIRED_ROUTES,
    required_api_calls: REQUIRED_API_CALLS,
    required_policy_modes: REQUIRED_POLICY_MODES,
    required_policy_lists: REQUIRED_LIST_FIELDS,
    safety_notes: [
      "Preferences surface presents manual, allow_listed, and allow_all approval modes from the client-owned global policy API.",
      "Preferences surface warns that allow_all should not be the default for public or team deployments.",
      "Access Lists surface manages responder whitelist, hotline whitelist, and Blocklist from the same client-owned policy API."
    ],
    files: [
      "apps/ops-console/src/App.tsx",
      "apps/ops-console/src/pages/caller/PreferencesPage.tsx",
      "apps/ops-console/src/pages/caller/AccessListsPage.tsx"
    ],
    blockers
  };
}

function printText(report) {
  console.log("Ops-console settings surface evidence");
  console.log("=====================================");
  console.log(`surface=${report.surface}`);
  console.log(`ok=${report.ok}`);
  for (const route of report.required_routes) console.log(`route=${route}`);
  for (const apiPath of report.required_api_calls) console.log(`api=${apiPath}`);
  for (const mode of report.required_policy_modes) console.log(`mode=${mode}`);
  for (const field of report.required_policy_lists) console.log(`policy_list=${field}`);
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
