# Responder Runtime CLI Architecture

## Goal

Make the responder side easy for local coding agents and end users to install and configure on a personal computer.

The intended flow is:

1. A user asks Codex, Claude Code, or another coding agent to install the responder side.
2. The tool runs a small set of stable `npx` commands.
3. A local responder runtime is configured, registered with platform review, and ready to host one or more hotlines.

This architecture does **not** treat Codex or Claude Code as hotlines. They are installation operators.

## Non-Goals

- Desktop installer in L0
- Docker-first responder install path for end users
- Hook-only integration model
- Rich multi-tenant admin workflow for responder onboarding

## Selected Direction

The responder side will use:

- `npx` / npm as the main install and setup path
- a local responder runtime process
- adapter-based hotline registration
- `process` adapter as the default integration model
- `http` adapter as the secondary integration model

## Why Not Hook-Only

Hook-only integration is too thin for the current protocol model:

- responder needs queueing, signing, ACK, heartbeat, retries, and status
- hotline integration needs a stable request/response contract
- local coding agents install more reliably through explicit CLI commands than through ad-hoc hook scripts

Hook support can exist later as a thin variant of the `process` adapter, but it should not be the primary interface.

## Current User-Facing CLI

The current user-facing package is:

- `@delexec/ops`

The current product-path commands are:

```bash
npx @delexec/ops setup
npx @delexec/ops auth register
npx @delexec/ops add-hotline
npx @delexec/ops submit-review
npx @delexec/ops enable-responder
npx @delexec/ops start
npx @delexec/ops status
npx @delexec/ops doctor
npx @delexec/ops debug-snapshot
```

Compatibility aliases still exist for some legacy `responder ...` subcommands, but they are no longer the documented primary path.

### Command Responsibilities

`setup`

- create local ops config if missing
- generate responder signing keypair if missing
- set default responder identity if missing
- persist config to local env/config files

`enable-responder`

- enable the local responder runtime
- keep local responder state separate from platform review submission

`submit-review`

- submit responder + pending hotline review requests to platform
- persist returned responder API key locally
- mark local hotlines as submitted with `review_status=pending`

`start`

- start the local ops supervisor
- start relay and caller automatically
- start responder when enabled and configured

`status`

- report local responder identity
- report supervisor / caller / responder / relay runtime status
- report last heartbeat time
- report configured hotlines
- report latest platform review state if available

`add-hotline`

- register a local hotline definition in responder config
- validate adapter config
- do not submit review automatically

`doctor`

- validate local config
- validate transport reachability
- validate platform connectivity
- validate adapter targets
- surface clear fix hints

## Local Config Model

The unified ops client uses a stable local config, separate from ad-hoc env-only setup.

Recommended files:

- `~/.delexec/.env.local`
- `~/.delexec/ops.config.json`

`.env.local` remains the simple key/value runtime file:

- `PLATFORM_API_BASE_URL`
- `PLATFORM_API_KEY`
- `RESPONDER_ID`
- `RESPONDER_SIGNING_PUBLIC_KEY_PEM`
- `RESPONDER_SIGNING_PRIVATE_KEY_PEM`
- `TRANSPORT_BASE_URL`

`ops.config.json` holds structured caller, responder, runtime, and adapter data:

```json
{
  "platform": {
    "base_url": "http://127.0.0.1:8080"
  },
  "caller": {
    "enabled": true,
    "api_key": "sk_caller_..."
  },
  "responder": {
    "enabled": true,
    "responder_id": "responder_local_ops",
    "display_name": "Local Responder",
    "hotlines": [
      {
        "hotline_id": "local.delegated-execution.workspace-summary.v1",
        "display_name": "Delegated Execution Workspace Summary",
        "enabled": true,
        "task_types": ["text_summarize"],
        "capabilities": ["text.summarize"],
        "tags": ["local", "workspace", "summary"],
        "adapter_type": "process",
        "adapter": {
          "cmd": "python3 /Users/me/agents/summary_agent.py",
          "cwd": "/Users/me/agents",
          "env": {}
        },
        "timeouts": {
          "soft_timeout_s": 60,
          "hard_timeout_s": 180
        }
      }
    ]
  },
  "runtime": {
    "ports": {
      "supervisor": 8079,
      "relay": 8090,
      "caller": 8081,
      "responder": 8082
    }
  }
}
```

## Adapter Model

### 1. Process Adapter

This is the default and recommended local integration path.

Use it for:

- local scripts
- Python or Node programs
- local coding-agent wrappers
- workflow runners
- command-line tools

Suggested CLI example:

```bash
npx @delexec/ops add-hotline \
  --type process \
  --hotline-id local.delegated-execution.workspace-summary.v1 \
  --display-name "Delegated Execution Workspace Summary" \
  --cmd "python3 /Users/me/agents/summary_agent.py" \
  --task-type text_summarize \
  --capability text.summarize
```

Machine-local CLI adapters may also carry a working directory plus explicit environment values:

```bash
npx @delexec/ops add-hotline \
  --type process \
  --hotline-id local.mineru.pdf.parse.v1 \
  --display-name "MinerU Local PDF Parse" \
  --cmd "\"/opt/homebrew/Cellar/node@22/22.22.0_1/bin/node\" \"$HOME/.delexec/local-hotline-workers/mineru/local-mineru-worker.js\"" \
  --cwd /Users/me/Projects/MinerU \
  --env MINERU_ROOT=/Users/me/Projects/MinerU \
  --env MINERU_BIN=/Users/me/Projects/MinerU/.venv/bin/mineru \
  --env MINERU_BACKEND=pipeline \
  --env MINERU_MODEL_SOURCE=local \
  --task-type document_parse \
  --capability document.parse.pdf \
  --tag local --tag mineru --tag pdf --tag parse
```

Runtime contract:

- responder runtime sends a single JSON payload to stdin
- child process returns a single JSON payload on stdout
- stderr is treated as diagnostic log output
- non-zero exit code becomes a responder execution error

Suggested stdin payload:

```json
{
  "request_id": "req_123",
  "task_type": "text_summarize",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "input": {
    "text": "..."
  },
  "constraints": {
    "hard_timeout_s": 120
  }
}
```

Suggested stdout payload:

```json
{
  "status": "ok",
  "output": {
    "summary": "..."
  },
  "usage": {
    "tokens_in": 100,
    "tokens_out": 40
  }
}
```

or

```json
{
  "status": "error",
  "error": {
    "code": "HOTLINE_FAILED",
    "message": "..."
  }
}
```

### 2. HTTP Adapter

Use it when the local capability already exists as a service.

Suggested CLI example:

```bash
npx @delexec/ops add-hotline \
  --type http \
  --hotline-id local.extractor.v1 \
  --display-name "Local Extractor API" \
  --url http://127.0.0.1:9001/invoke \
  --task-type extract \
  --capability field.extract
```

Contract:

- responder runtime sends a JSON `POST`
- hotline service returns the same normalized `ok/error` structure as the process adapter

### 3. Function Adapter

Keep this for internal demos and tests, not as the main user-facing integration path.

## `add-hotline` Behavior

`add-hotline` should be a local adapter registrar, not just a platform catalog writer.

Current behavior:

1. validate input flags or config file
2. write the hotline definition into `ops.config.json`
3. update runtime-facing env/config if needed
4. leave review submission as an explicit later step via `submit-review`
5. leave the responder runtime able to load the new hotline after restart or reload

### Input Modes

Support both:

1. interactive mode
2. declarative mode

Interactive:

```bash
npx @delexec/ops add-hotline
```

Declarative:

```bash
npx @delexec/ops add-hotline --config ./hotline.json
```

Declarative mode is important for coding-agent installation flows.

## Runtime Loading Model

Current code already supports:

- responder identity with multiple `hotline_ids`
- background heartbeat
- background inbox polling

Current implementation:

- responder identity preserves multiple `hotline_ids`
- responder runtime loads per-hotline adapters from local config
- tasks are routed by `hotline_id`
- responder status endpoints expose configured hotlines and adapter summaries

## Remaining Gaps

The main remaining gaps are now product-depth gaps rather than architecture gaps:

1. stronger field validation and recovery hints in the hotline editor
2. richer browser workflow coverage beyond current DOM/view-model tests
3. more advanced observability around adapter performance and failure rates
4. richer search/ranking for responder discovery on the caller side

## Current Code Touch Points

- `apps/ops/src/cli.js`
- `apps/ops/src/supervisor.js`
- `apps/responder-controller/src/server.js`
- `packages/responder-runtime-core/src/index.js`
- `packages/responder-runtime-core/src/executors.js`
- `apps/ops-console/src/main.js`
- `deploy/ops/README.md`
- `README.md`
