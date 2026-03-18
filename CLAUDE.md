# CLAUDE.md

This repository is the client-side implementation and CLI surface for delegated execution.

## Start Here

Read in this order before changing behavior:

1. `README.md`
2. `docs/current/guides/release-surface.md`
3. `docs/current/guides/end-user-ai-deployment-guide.md`
4. `docs/current/guides/coding-agent-onboarding.md`
5. `docs/current/guides/rename-local-state-migration-map.md`

## Repository Boundary

This repository owns:

- `@delexec/ops`
- `delexec-ops`
- local buyer and seller orchestration
- local persistence, secret handling, and SQLite-backed client state
- client-side transport wiring and end-user onboarding flows

This repository does not own:

- protocol truth-source definitions
- self-hosted operator deployment

## Development Rules

- Optimize for the `delexec-ops` experience. Do not make normal users assemble internal packages manually.
- Shared support packages may stay publishable during the split transition, but they are not the main product surface.
- If a change alters protocol semantics, release `@delexec/contracts` first and then update this repository.
- Keep local-state migrations, CLI docs, and behavior aligned.

## Validation

Run after meaningful changes:

```bash
npm install
npm test
npm run test:packages
```

## Release Rule

Release shared support packages only when another repository still depends on them. The primary end-user release artifact is `@delexec/ops`.
