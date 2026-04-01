# Local Mode Onboarding

Use this guide when you want to verify the `client` repository in **local mode** only:

- no platform review
- no platform catalog publishing
- no `submit-review`

This flow validates:

1. local setup and unlock
2. caller registration
3. local responder enablement
4. local hotline draft generation
5. local hotline discovery
6. local example self-call

This path is now officially supported without:

- platform
- Docker
- external relay packages
- fake platform API keys
- manual `ops.config.json` edits

## Scope

Local mode means:

- `platform.enabled = false`
- responder hotlines remain `local_only`
- drafts are still generated and remain the primary hotline configuration view
- caller discovers local hotlines from the same machine

Machine-local hotline state is stored under `DELEXEC_HOME`, not in the repository:

- `ops.config.json`: local runtime snapshot
- `hotline-registration-drafts/`: caller-facing hotline draft JSON files
- `hotline-integrations/`: machine-local adapter config such as commands, URLs, and project paths
- `hotline-hooks/`: optional machine-local hook stubs

## Prepare

Work in the `client` repository:

```bash
cd /Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client
corepack pnpm install
```

Use an isolated home directory so you do not mix this test with an existing local environment:

```bash
export DELEXEC_HOME="$HOME/.delexec-client-localtest"
export OPS_PORT_SUPERVISOR=8179
export OPS_PORT_CALLER=8181
export OPS_PORT_RESPONDER=8182
export OPS_PORT_RELAY=8190
export OPS_PORT_SKILL_ADAPTER=8191
```

## Start the local runtime

```bash
DELEXEC_HOME="$DELEXEC_HOME" \
OPS_PORT_SUPERVISOR="$OPS_PORT_SUPERVISOR" \
OPS_PORT_CALLER="$OPS_PORT_CALLER" \
OPS_PORT_RESPONDER="$OPS_PORT_RESPONDER" \
OPS_PORT_RELAY="$OPS_PORT_RELAY" \
OPS_PORT_SKILL_ADAPTER="$OPS_PORT_SKILL_ADAPTER" \
corepack pnpm --filter @delexec/ops exec node src/cli.js start
```

`delexec-ops start` automatically uses the embedded local relay when `TRANSPORT_TYPE=local`. You do not need `OPS_RELAY_BIN` or any extra relay install for this path.

Check status:

```bash
curl http://127.0.0.1:8179/status
```

Expected:

- `platform.enabled` is `false`
- `runtime.relay.launch_mode = "embedded_local"`
- responder is disabled
- no hotlines are configured yet

## Initialize local secrets

Initialize runtime state:

```bash
curl -X POST http://127.0.0.1:8179/setup \
  -H 'content-type: application/json' \
  -d '{}'
```

Create a local passphrase:

```bash
curl -X POST http://127.0.0.1:8179/auth/session/setup \
  -H 'content-type: application/json' \
  -d '{"passphrase":"client-localtest-123"}'
```

Save the returned token:

```bash
export OPS_SESSION="<returned token>"
```

## Register the local caller

```bash
curl -X POST http://127.0.0.1:8179/auth/register-caller \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{"contact_email":"localtest@example.com"}'
```

Expected:

- `mode = "local_only"`
- `registered = true`
- `caller.registration_mode = "local_only"` in `/status`
- no platform API key is required for local mode

CLI equivalent:

```bash
delexec-ops auth register --local --email localtest@example.com
```

## Enable the local responder runtime

```bash
curl -X POST http://127.0.0.1:8179/responder/enable \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{"responder_id":"client-local-responder","display_name":"Client Local Responder"}'
```

This step enables the **local responder runtime** only. It does not publish anything to platform.

## Add the official example hotline

```bash
curl -X POST http://127.0.0.1:8179/responder/hotlines/example \
  -H 'content-type: application/json' \
  -d '{}'
```

Expected:

- `hotline_id = local.delegated-execution.workspace-summary.v1`
- a `registration_draft_file` is returned
- a `local_integration_file` is returned
- a `local_hook_file` is returned
- the example hotline is enabled locally

## Inspect the local draft

```bash
curl http://127.0.0.1:8179/responder/hotlines/local.delegated-execution.workspace-summary.v1/draft \
  -H "X-Ops-Session: $OPS_SESSION"
```

Expected:

- `platform_enabled = false`
- `review_status = local_only`
- `submitted_for_review = false`
- `draft_ready = true`

The draft is the primary hotline configuration view in local mode. Check:

- `description`
- `summary`
- `input_schema.properties.<field>.description`
- `output_schema`
- `input_summary`
- `output_summary`

Each input field must have caller-facing guidance.

Also inspect the machine-local integration files under `DELEXEC_HOME`:

- `hotline-integrations/<hotline-id>.integration.json`
- `hotline-hooks/<hotline-id>.hooks.json`

Keep machine-specific commands, URLs, paths, and hooks there so they do not end up in git-tracked files.

## Verify local discovery

```bash
curl http://127.0.0.1:8179/catalog/hotlines \
  -H "X-Ops-Session: $OPS_SESSION"
```

Expected:

- the example hotline is listed
- `catalog_visibility = "local"`
- `source = "local"`
- `review_status = "local_only"`

## Run a local example call

```bash
curl -X POST http://127.0.0.1:8179/requests/example \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{}'
```

Save the returned request ID:

```bash
export REQUEST_ID="<returned request_id>"
```

The response should also include:

- `hotline_id = "local.delegated-execution.workspace-summary.v1"`
- `draft_file` pointing to the local hotline draft under `DELEXEC_HOME/hotline-registration-drafts/`

Poll the result:

```bash
curl http://127.0.0.1:8179/requests/$REQUEST_ID/result \
  -H "X-Ops-Session: $OPS_SESSION"
```

Expected:

- `available = true`
- `status = "SUCCEEDED"`
- `result_package.status = "ok"`
- signature fields are present

## Done

The local-mode onboarding is complete when all of the following are true:

- local setup and unlock succeeded
- caller registration succeeded
- local responder is enabled
- the example hotline exists and has a draft
- local catalog discovery works
- the example self-call reaches `SUCCEEDED`

## What this guide does not cover

This guide intentionally does not cover:

- platform review submission
- platform approval
- platform catalog publishing
- relay or email deployment shapes

For those flows, continue with the platform-oriented guides after local mode is already working.
