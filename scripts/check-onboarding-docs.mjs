import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const docs = [
  "README.md",
  "docs/current/guides/local-mode-onboarding.md",
  "docs/current/guides/local-mode-onboarding.zh-CN.md",
  "docs/current/guides/agent-local-install-playbook.md",
  "docs/current/guides/agent-local-install-playbook.zh-CN.md",
  "docs/current/guides/coding-agent-onboarding.md",
  "docs/current/guides/coding-agent-onboarding.zh-CN.md",
  "docs/current/guides/deployment-guide.md",
  "docs/current/guides/deployment-guide.zh-CN.md",
  "docs/current/guides/end-user-ai-deployment-guide.md",
  "docs/current/guides/end-user-ai-deployment-guide.zh-CN.md"
];

const requiredCommands = [
  /delexec-ops bootstrap|npm run ops -- bootstrap/,
  /delexec-ops status|npm run ops -- status/,
  /delexec-ops run-example|npm run ops -- run-example/,
  /delexec-ops debug-snapshot|npm run ops -- debug-snapshot/
];

const goldenPath = `npm install -g @delexec/ops
delexec-ops bootstrap --email you@example.com --text "Summarize this bootstrap request."
delexec-ops status
delexec-ops run-example --text "Summarize this follow-up request."`;

const errors = [];

function requireInstalledPackageFirst(docPath) {
  const content = fs.readFileSync(path.join(ROOT, docPath), "utf8");
  if (!content.includes(goldenPath)) {
    errors.push(`${docPath}: missing exact installed-package golden path`);
  }

  const installedIndex = content.indexOf("npm install -g @delexec/ops");
  const sourceIndex = content.indexOf("npm install\nnpm run ops --");
  if (installedIndex === -1 || sourceIndex === -1 || installedIndex > sourceIndex) {
    errors.push(`${docPath}: installed-package golden path must appear before source install path`);
  }
}

for (const docPath of docs) {
  const absolute = path.join(ROOT, docPath);
  const content = fs.readFileSync(absolute, "utf8");

  if (/delexec-ops auth login/.test(content)) {
    errors.push(`${docPath}: stale command delexec-ops auth login`);
  }

  for (const pattern of requiredCommands) {
    if (!pattern.test(content)) {
      errors.push(`${docPath}: missing recommended command pattern ${pattern}`);
    }
  }

  if (/local-mode-onboarding|agent-local-install-playbook/.test(docPath) && !/OPS_PORT_MCP_ADAPTER/.test(content)) {
    errors.push(`${docPath}: missing OPS_PORT_MCP_ADAPTER in isolated port list`);
  }
}

requireInstalledPackageFirst("README.md");
requireInstalledPackageFirst("README.zh-CN.md");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`[check-onboarding-docs] ok docs=${docs.length}`);
