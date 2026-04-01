# Coding Agent Onboarding

This repository now includes a stable **local-first** path for coding agents.

## Current Scope

Current coding-agent onboarding in this repository is limited to:

- local setup and unlock
- local caller registration
- local responder enablement
- local hotline draft generation
- local hotline discovery and self-call

Platform publishing and community-facing flows remain later work and are not the primary onboarding target here.

## Recommended Path

Start with the local-mode guide:

- [Local Mode Onboarding](./local-mode-onboarding.md)
- [Agent Local Install Playbook](./agent-local-install-playbook.md)

Recommended commands:

```bash
npm install -g @delexec/ops
delexec-ops setup
delexec-ops auth login
delexec-ops auth register --email coding-agent@local.test
delexec-ops enable-responder
delexec-ops add-example-hotline
delexec-ops run-example --text "Summarize this request."
```

## Success Criteria

The local path is complete when:

- local setup succeeds
- caller registration succeeds
- responder is enabled
- the example hotline is installed
- a local draft exists
- the example self-call reaches `SUCCEEDED`

## Useful Follow-Up Commands

```bash
delexec-ops add-example-hotline
delexec-ops run-example --text "Summarize this request."
delexec-ops doctor
delexec-ops debug-snapshot
```

## Useful Logs And Snapshots

- local ops home: `~/.delexec`
- runtime logs: `~/.delexec/logs`
- debug snapshot: `GET http://127.0.0.1:8079/debug/snapshot`
- supervisor status: `GET http://127.0.0.1:8079/status`
