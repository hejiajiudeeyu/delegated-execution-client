# Tests

This directory documents the test surface that actually ships in the current `client` checkout.

## Layout

- `tests/unit`: pure logic and component-level tests
- `tests/integration`: HTTP/runtime integration tests for the local client services
- `tests/helpers`: shared test helpers
- `tests/config`: Vitest config files

Current integration coverage includes:

- `ops` CLI and supervisor flows
- caller controller request flow
- caller-skill adapter and MCP adapter
- responder controller registration/runtime flow
- local, relay HTTP, EmailEngine, and Gmail transport adapters

## Run From The Client Repository

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:packages
```

## Important Scope Boundary

This checkout does **not** currently ship these older layers or scripts:

- `tests/e2e`
- `tests/mocks`
- `tests/reports/latest.json`
- `npm run test:e2e`
- `npm run test:compose-smoke`
- `npm run test:public-stack-smoke`
- `npm run test:local-images-smoke`
- `npm run test:published-images-smoke`

Do not treat those paths as currently available unless the matching files and `package.json` scripts are added back in the same checkout.

## Cross-Repo Certification

Cross-repo compatibility for the pinned SHA set is validated from the fourth-repo workspace root, not from this `client` package alone:

```bash
corepack pnpm run check:submodules
corepack pnpm run check:boundaries
corepack pnpm run check:bundles
corepack pnpm run test:contracts
corepack pnpm run test:integration
```

## Local Runtime Smoke

For a fresh-home usability check of the current local-first path, use the source CLI directly from this repository:

```bash
node apps/ops/src/cli.js bootstrap --email you@example.com
node apps/ops/src/cli.js status
node apps/ops/src/cli.js ui start --no-browser
```

Use an isolated `DELEXEC_HOME` when you want a clean local smoke run.
