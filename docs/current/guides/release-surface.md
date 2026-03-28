# Client Release Surface

This repository is user-facing through a single primary client package:

- `@delexec/ops`

## Primary Product Surface

Normal users should interact with this repository through:

- `npm install -g @delexec/ops`
- `npx @delexec/ops`
- `delexec-ops ...`

## Internal Support Packages

This repository still contains support packages such as:

- `@delexec/runtime-utils`
- `@delexec/sqlite-store`
- `@delexec/caller-controller-core`
- `@delexec/responder-runtime-core`
- `@delexec/transport-*`

These packages exist to support:

- repository-local development
- clean-room package validation
- split-transition cross-repository dependencies

They are not the main product surface and should not be treated as the normal user installation path.

## Release Policy

1. Release `@delexec/contracts` first when protocol changes are involved.
2. Release support packages only when another repository still requires them.
3. Release `@delexec/ops` as the main end-user client artifact.

## Development Rule

When deciding where to invest UX and documentation effort, optimize for `delexec-ops`, not for manual assembly of internal packages.
