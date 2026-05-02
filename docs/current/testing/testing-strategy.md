# Testing Strategy (Current Client Checkout)

This document records the validation layers that actually exist in the current `client` repository checkout.

## 1. Goal

Keep the local-first client path verifiable at three levels:

- logic and component behavior
- service-to-service integration inside the client repo
- pinned-SHA cross-repo certification from the fourth-repo workspace

## 2. Validation Layers

- `Unit`: logic, schema handling, runtime helpers, and UI component behavior
- `Integration`: real HTTP/runtime tests for `ops`, caller, responder, caller-skill adapter, MCP adapter, and transport adapters
- `Package checks`: publish/install shape validation for the client packages
- `Workspace certification`: top-level fourth-repo checks for submodule integrity, boundaries, contracts, and source integration

## 3. What Exists In This Checkout

Available commands in `repos/client/package.json`:

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:packages
```

Current test directories in this checkout:

- `tests/unit`
- `tests/integration`
- `tests/helpers`
- `tests/config`

## 4. What Does Not Exist In This Checkout

The following historical or aspirational layers are not present right now and should not be treated as runnable truth:

- `tests/e2e`
- `tests/mocks`
- `tests/reports/latest.json`
- `npm run test:e2e`
- `npm run test:compose-smoke`
- `npm run test:public-stack-smoke`
- `npm run test:local-images-smoke`
- `npm run test:published-images-smoke`

If those layers return later, they should be documented only together with the actual files and package scripts that implement them.

## 5. Cross-Repo Certification Path

Cross-repo compatibility is currently certified from the fourth-repo workspace root:

```bash
corepack pnpm run check:submodules
corepack pnpm run check:boundaries
corepack pnpm run check:bundles
corepack pnpm run test:contracts
corepack pnpm run test:integration
```

Use that path when you need to claim the pinned `protocol + client + platform` SHA set is compatible.

## 6. Local Smoke And Debug Feedback

For a machine-local usability check of the current product path, use a fresh `DELEXEC_HOME` and run:

```bash
node apps/ops/src/cli.js bootstrap --email you@example.com
node apps/ops/src/cli.js status
node apps/ops/src/cli.js ui start --no-browser
```

Primary runtime feedback surfaces are:

- `delexec-ops status`
- `delexec-ops doctor`
- `delexec-ops debug-snapshot`
- `DELEXEC_HOME/logs/supervisor.events.jsonl`
- service logs under `DELEXEC_HOME/logs/`
