# delegated-execution-client

Client-side runtime and CLI for delegated execution.

This repository contains the client-side implementation split from the original monorepo.

## AI Collaboration

- `CLAUDE.md` defines the repository-specific development and validation rules.
- `AGENTS.md` gives a minimal routing and ownership summary for AI coding agents.

## Public Product Surface

The only end-user installation entry for this repository is:

- `@delexec/ops`

Users should install or run the client through `delexec-ops`, not by assembling caller, responder, storage, or transport packages manually.

User-facing terminology follows the cross-repo mapping in [`../../docs/architecture/terminology.md`](../../docs/architecture/terminology.md):

- `Caller` is the preferred product term for `Caller`
- `Responder` is the preferred product term for `Responder`
- `Hotline` is the marketplace-facing label for a published service entry

Recommended user-facing entrypoints:

```bash
npm install -g @delexec/ops
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

For a local web-first onboarding flow in the source workspace:

```bash
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080 --open-ui
```

After bootstrap completes, reopen the local web UI with:

```bash
delexec-ops ui start --open
```

To attach a local project as a responder Hotline:

```bash
delexec-ops attach-project \
  --project-path /absolute/path/to/project \
  --project-name "My Local Project" \
  --project-description "Explain what this project can do for remote callers" \
  --hotline-id local.my-project.v1 \
  --cmd "node worker.js"
```

## Repository Responsibility

This repository owns the end-user client runtime:

- the `@delexec/ops` product package and `delexec-ops` CLI
- caller-side local control flow and responder-side local runtime management, implemented by caller/responder runtimes
- local state, secret handling, SQLite-backed client storage, and local transport adapters
- client-side onboarding, bootstrap, diagnostics, and troubleshooting docs

This repository does not own protocol truth-source definitions or the operator-facing self-hosted platform deployment surface.

## Status

`@delexec/contracts` is now published on npm, so this repository can run standalone CI and clean-room package checks.

## Internal Packages

This repository still contains internal implementation packages such as caller/responder controllers, local storage, and transport adapters. They remain testable and publishable because `@delexec/ops` depends on them, but they are not the primary product surface.

## Maintainer Notes

Some shared packages from this repository are still published separately because other repositories consume them during the split transition.

They should be treated as implementation support packages, not the main client product surface.

See also: `docs/current/guides/release-surface.md`
See also: `docs/current/guides/source-integration-runbook.md`

## How To Develop Here

- Start here when the change affects end-user CLI flows, local caller/responder behavior, local persistence, or client-side transport wiring.
- Preserve the product boundary: normal users should only need `@delexec/ops`, not a bundle of internal packages.
- Keep shared internal packages stable enough for tests and packaging, but optimize docs and examples for the `delexec-ops` path.

Recommended change flow:

1. If the change alters protocol semantics, update `delegated-execution-protocol` first and consume the released `@delexec/contracts`.
2. Implement client runtime and CLI changes here.
3. Run repository CI plus package checks before release.
4. Release shared support packages only when another repository depends on them; otherwise release `@delexec/ops` as the user-facing artifact.
