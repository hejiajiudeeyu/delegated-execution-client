# delegated-execution-client

Client-side runtime and CLI for delegated execution.

This repository contains the client-side implementation split from the original monorepo.

## Public Product Surface

The only end-user installation entry for this repository is:

- `@delexec/ops`

Users should install or run the client through `delexec-ops`, not by assembling buyer, seller, storage, or transport packages manually.

Recommended user-facing entrypoints:

```bash
npm install -g @delexec/ops
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

## Repository Responsibility

This repository owns the end-user client runtime:

- the `@delexec/ops` product package and `delexec-ops` CLI
- buyer-side local control flow and seller-side local runtime management
- local state, secret handling, SQLite-backed client storage, and local transport adapters
- client-side onboarding, bootstrap, diagnostics, and troubleshooting docs

This repository does not own protocol truth-source definitions or the operator-facing self-hosted platform deployment surface.

## Status

`@delexec/contracts` is now published on npm, so this repository can run standalone CI and clean-room package checks.

## Internal Packages

This repository still contains internal implementation packages such as buyer/seller controllers, local storage, and transport adapters. They remain testable and publishable because `@delexec/ops` depends on them, but they are not the primary product surface.

## Maintainer Notes

Some shared packages from this repository are still published separately because other repositories consume them during the split transition.

They should be treated as implementation support packages, not the main client product surface.

## How To Develop Here

- Start here when the change affects end-user CLI flows, local buyer/seller behavior, local persistence, or client-side transport wiring.
- Preserve the product boundary: normal users should only need `@delexec/ops`, not a bundle of internal packages.
- Keep shared internal packages stable enough for tests and packaging, but optimize docs and examples for the `delexec-ops` path.

Recommended change flow:

1. If the change alters protocol semantics, update `delegated-execution-protocol` first and consume the released `@delexec/contracts`.
2. Implement client runtime and CLI changes here.
3. Run repository CI plus package checks before release.
4. Release shared support packages only when another repository depends on them; otherwise release `@delexec/ops` as the user-facing artifact.
