# delegated-execution-client

Client-side runtime and local web console for delegated execution.

Install once and use `delexec-ops` to act as a **Caller** (delegate tasks to remote Hotlines) or a **Responder** (expose local projects as Hotlines for others to call).

> 中文版：[README.zh-CN.md](README.zh-CN.md)

---

## Quick Start

### Local Mode

Use local mode when you want to validate the client-only flow on one machine without platform review or catalog publishing.

See [Local Mode Onboarding](docs/current/guides/local-mode-onboarding.md).
If you want another agent to perform the installation for you, start with [Agent Local Install Playbook](docs/current/guides/agent-local-install-playbook.md).

The official local-only path now includes:

- embedded local relay started by `delexec-ops start`
- `delexec-ops auth register --local --email <email>`
- local responder enablement
- example hotline draft inspection
- a local self-call to `SUCCEEDED`

Keep machine-local hotline integration config and hook files under `DELEXEC_HOME`, not in the git worktree. The local runtime uses:

- `ops.config.json` for runtime state
- `hotline-registration-drafts/` for hotline drafts
- `hotline-integrations/` for machine-local adapter config
- `hotline-hooks/` for optional machine-local hook stubs

### Platform Bootstrap (Later Workflow)

Platform/community publishing is not the current primary product path in this repository. Treat it as a later workflow after local mode already works.

If you are validating the current product path, stop at local mode and do **not** start here first.

```bash
npm install -g @delexec/ops
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

Open the local web console after bootstrap:

```bash
delexec-ops ui start --open
```

The setup wizard guides you through setting a local passphrase and registering your Caller identity in one flow.

![Setup Wizard](docs/screenshots/setup-wizard.png)

---

## Dashboard

After login, the Dashboard gives a live overview of all local service processes. Platform connectivity is optional and should be treated as a later enhancement, not as the first-use requirement.

![Dashboard](docs/screenshots/dashboard.png)

Service health cards show the status of:

- **Caller process** — the local caller-controller runtime
- **Responder process** — the local responder-controller runtime
- **Relay** — the local transport relay (if used)
- **Platform API** — reachability of the connected platform

---

## Transport Configuration

Switch the transport channel between **Local**, **Relay HTTP**, and **Email** from the Transport page without restarting any services.

![Transport Configuration](docs/screenshots/transport-config.png)

- **Local** — direct in-process communication; no network required. Best for development and testing.
- **Relay HTTP** — routes messages through an HTTP relay. Suitable for cross-machine deployments or behind firewalls.
- **Email** — asynchronous email-based transport via EmailEngine or Gmail. Supports human-in-the-loop workflows.

---

## Caller — Delegate Tasks

### Hotline Catalog

In the current product path, browse and invoke local Hotlines first. Platform-published Hotlines are a later workflow after local mode is already working.

![Hotline Catalog](docs/screenshots/caller-catalog.png)

Each Hotline card shows the Hotline ID, a description, and capability tags. Click **调用** to send a call request.

### Call Requests

Track all outgoing call requests and their status in real time. The manual test panel lets you send a test call to any Hotline ID directly.

![Call Requests](docs/screenshots/caller-calls.png)

---

## Responder — Expose Local Projects

### Hotline Management

Register your local project as a Hotline and enable or disable it with a single toggle. The Responder side manages which Hotlines are active locally first. Platform review and catalog publishing remain later workflows.

![Hotline Management](docs/screenshots/responder-hotlines.png)

To attach a local project as a Hotline:

```bash
delexec-ops attach-project \
  --project-path /absolute/path/to/project \
  --project-name "My Local Project" \
  --project-description "Explain what this project can do for remote callers" \
  --hotline-id local.my-project.v1 \
  --cmd "node worker.js"
```

---

## Repository Responsibility

This repository owns the end-user client runtime:

- the `@delexec/ops` product package and `delexec-ops` CLI
- caller-side local control flow and responder-side local runtime management
- local state, secret handling, SQLite-backed client storage, and local transport adapters
- client-side onboarding, bootstrap, diagnostics, and troubleshooting docs

This repository does not own protocol truth-source definitions or the operator-facing self-hosted platform deployment surface.

## AI Collaboration

- `CLAUDE.md` defines the repository-specific development and validation rules.
- `AGENTS.md` gives a minimal routing and ownership summary for AI coding agents.

## Public Product Surface

The only end-user installation entry for this repository is `@delexec/ops`. Users should install or run the client through `delexec-ops`, not by assembling internal packages manually.

## Internal Packages

This repository contains internal implementation packages (caller/responder controllers, local storage, transport adapters). They remain testable and publishable because `@delexec/ops` depends on them, but they are not the primary product surface.

## Status

`@delexec/contracts` is now published on npm, so this repository can run standalone CI and clean-room package checks.

## Maintainer Notes

Some shared packages from this repository are still published separately because other repositories consume them during the split transition. They should be treated as implementation support packages, not the main client product surface.

See also: `docs/current/guides/release-surface.md`
See also: `docs/current/guides/source-integration-runbook.md`

## How To Develop Here

- Start here when the change affects end-user CLI flows, local caller/responder behavior, local persistence, or client-side transport wiring.
- Preserve the product boundary: normal users should only need `@delexec/ops`.
- Keep shared internal packages stable enough for tests and packaging, but optimize docs and examples for the `delexec-ops` path.

Recommended change flow:

1. If the change alters protocol semantics, update `delegated-execution-protocol` first and consume the released `@delexec/contracts`.
2. Implement client runtime and CLI changes here.
3. Run repository CI plus package checks before release.
4. Release shared support packages only when another repository depends on them; otherwise release `@delexec/ops` as the user-facing artifact.
