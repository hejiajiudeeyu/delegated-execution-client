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

const errors = [];

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

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`[check-onboarding-docs] ok docs=${docs.length}`);
