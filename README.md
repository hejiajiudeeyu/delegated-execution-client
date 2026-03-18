# delegated-execution-client

Client-side runtime and CLI for delegated execution.

This repository contains the client-side implementation split from the original monorepo.

## Public Product Surface

The only end-user installation entry for this repository is:

- `@delexec/ops`

Users should install or run the client through `delexec-ops`, not by assembling buyer, seller, storage, or transport packages manually.

## Status

`@delexec/contracts` is now published on npm, so this repository can run standalone CI and clean-room package checks.

## Internal Packages

This repository still contains internal implementation packages such as buyer/seller controllers, local storage, and transport adapters. They remain testable and publishable because `@delexec/ops` depends on them, but they are not the primary product surface.

## Shared Package Publish Order

Before `delegated-execution-platform-selfhost` can install cleanly from npm, publish these shared packages from this repository first:

1. `@delexec/runtime-utils`
2. `@delexec/sqlite-store`
3. `@delexec/buyer-controller-core`
4. `@delexec/seller-runtime-core`
5. transport packages
6. app packages as needed for clean-room verification

After that, the main client-facing package to publish and document is `@delexec/ops`.
