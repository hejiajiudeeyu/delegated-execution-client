# End-User AI Deployment Guide

This guide describes the current supported path for letting an AI help an end user install and bootstrap the local client.

## Current Supported Install Strategy

The supported user-facing install path is the published CLI package:

```bash
npm install -g @delexec/ops
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

## What The AI Should Do

The recommended AI flow is:

1. install `@delexec/ops`
2. run the single bootstrap command
4. inspect the JSON output
5. if approval is pending, tell the user or operator exactly that
6. after approval, rerun bootstrap or `run-example`

## Single-Command Bootstrap

```bash
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

This flow attempts to:

1. initialize `~/.delexec`
2. register the caller
3. install the official example hotline
4. submit responder and hotline review
5. enable the local responder runtime
6. start the local supervisor
7. run the local example self-call

## Expected Output

The command returns JSON. The AI should read the output instead of parsing shell text heuristically.

Success shape:

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "status": "SUCCEEDED"
}
```

Pending-approval shape:

```json
{
  "ok": false,
  "stage": "awaiting_admin_approval"
}
```

## Useful Follow-Up Commands

```bash
delexec-ops run-example --text "Summarize this request."
delexec-ops doctor
delexec-ops debug-snapshot
```

## What The AI Should Report Back

The AI should summarize only these user-relevant outcomes:

- setup completed or not
- caller registration completed or not
- review submitted or not
- responder enabled or not
- admin approval still required or not
- example request succeeded or not

## Current Limits

- platform must already be reachable
- responder and hotline still require admin approval
- email transport is optional and not required for the bootstrap path
