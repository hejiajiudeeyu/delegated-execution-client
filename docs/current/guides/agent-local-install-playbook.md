# Agent Local Install Playbook

Use this playbook when you want an agent to install and verify the current `client` product path from repository source.

This playbook is intentionally strict:

- local mode only
- no platform review
- no platform catalog publishing
- no `submit-review`
- no Docker

## What the agent should accomplish

The agent should complete this local-only flow:

1. install dependencies in the `client` repository
2. start the local runtime with an isolated `DELEXEC_HOME`
3. initialize local secrets
4. register a local caller
5. enable the local responder runtime
6. add the official example hotline
7. inspect the generated draft
8. run one local example self-call until it reaches `SUCCEEDED`

## Repository Source

Default GitHub repository:

```bash
git@github.com:hejiajiudeeyu/delegated-execution-client.git
```

Example clone flow:

```bash
git clone git@github.com:hejiajiudeeyu/delegated-execution-client.git
cd delegated-execution-client
```

## Required Runtime Assumptions

The agent should assume:

- Node.js and `corepack` are available
- `pnpm` is used through `corepack`
- platform is **not** required for this flow
- the current product path is local-first

## Recommended Isolated Environment

The agent should use an isolated local state directory and non-default ports:

```bash
export DELEXEC_HOME="$HOME/.delexec-agent-local-install"
export OPS_PORT_SUPERVISOR=8179
export OPS_PORT_CALLER=8181
export OPS_PORT_RESPONDER=8182
export OPS_PORT_RELAY=8190
export OPS_PORT_SKILL_ADAPTER=8191
```

## Install And Start

```bash
git clone git@github.com:hejiajiudeeyu/delegated-execution-client.git
cd delegated-execution-client
corepack pnpm install

DELEXEC_HOME="$DELEXEC_HOME" \
OPS_PORT_SUPERVISOR="$OPS_PORT_SUPERVISOR" \
OPS_PORT_CALLER="$OPS_PORT_CALLER" \
OPS_PORT_RESPONDER="$OPS_PORT_RESPONDER" \
OPS_PORT_RELAY="$OPS_PORT_RELAY" \
OPS_PORT_SKILL_ADAPTER="$OPS_PORT_SKILL_ADAPTER" \
corepack pnpm --filter @delexec/ops exec node src/cli.js start
```

Local machine-specific hotline state should stay under `DELEXEC_HOME`:

- `ops.config.json`
- `hotline-registration-drafts/`
- `hotline-integrations/`
- `hotline-hooks/`

Do not create hotline-specific command, URL, path, or hook files inside the git worktree.

## Initialize Local Mode

```bash
curl -X POST http://127.0.0.1:8179/setup \
  -H 'content-type: application/json' \
  -d '{}'

curl -X POST http://127.0.0.1:8179/auth/session/setup \
  -H 'content-type: application/json' \
  -d '{"passphrase":"agent-local-install-123"}'
```

Save the returned token:

```bash
export OPS_SESSION="<returned token>"
```

## Register Caller

```bash
curl -X POST http://127.0.0.1:8179/auth/register-caller \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{"contact_email":"agent-local@example.com"}'
```

## Enable Local Responder

```bash
curl -X POST http://127.0.0.1:8179/responder/enable \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{"responder_id":"agent-local-responder","display_name":"Agent Local Responder"}'
```

## Add The First Hotline

```bash
curl -X POST http://127.0.0.1:8179/responder/hotlines/example \
  -H 'content-type: application/json' \
  -d '{}'
```

Expected hotline ID:

```bash
local.delegated-execution.workspace-summary.v1
```

## Inspect The Draft

```bash
curl http://127.0.0.1:8179/responder/hotlines/local.delegated-execution.workspace-summary.v1/draft \
  -H "X-Ops-Session: $OPS_SESSION"
```

The agent should verify:

- `platform_enabled = false`
- `review_status = local_only`
- `draft_ready = true`
- every input field has caller-facing fill guidance in `input_schema.properties.<field>.description`
- a machine-local integration file exists under `hotline-integrations/`
- a machine-local hook stub exists under `hotline-hooks/`

## Run The First Local Call

```bash
curl -X POST http://127.0.0.1:8179/requests/example \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{}'
```

Then poll:

```bash
curl http://127.0.0.1:8179/requests/<request_id>/result \
  -H "X-Ops-Session: $OPS_SESSION"
```

## Success Criteria

The agent should report success only when:

- local setup succeeded
- caller registration succeeded
- local responder enablement succeeded
- the example hotline exists
- the draft is readable
- the example self-call reaches `SUCCEEDED`
- the result package is available and signed

## Prompt Template For Another Agent

You can give another agent a prompt like this:

```text
Install and verify the local-only client flow from source.

Repository:
git@github.com:hejiajiudeeyu/delegated-execution-client.git

Requirements:
1. Use local mode only
2. Do not start platform or Docker
3. Use an isolated DELEXEC_HOME
4. Complete setup, caller registration, responder enablement, first example hotline creation, draft inspection, and one successful local self-call
5. Return the supervisor status URL, hotline ID, draft path, and request ID
```

## What Not To Do

The agent should not:

- start platform as part of this flow
- run `submit-review`
- treat platform approval as a prerequisite
- modify protocol fields
- use real personal data in committed test fixtures
