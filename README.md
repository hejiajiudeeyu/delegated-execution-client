# delegated-execution-client

Buyer, seller, and ops client runtime for delegated execution.

This repository contains the client-side packages and apps split from the original monorepo, including buyer/seller controllers, ops CLI, ops console, local storage, and transport adapters.

## Status

`@delexec/contracts` is now published on npm, so this repository can run standalone CI and clean-room package checks.

## Publish Order

Before `delegated-execution-platform-selfhost` can install cleanly from npm, publish these shared packages from this repository first:

1. `@delexec/runtime-utils`
2. `@delexec/sqlite-store`
3. `@delexec/buyer-controller-core`
4. `@delexec/seller-runtime-core`
5. transport packages
6. app packages such as `@delexec/ops`, `@delexec/buyer-controller`, and `@delexec/seller-controller`
