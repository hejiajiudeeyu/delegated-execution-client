# Caller Skill MCP in Cursor

Status: Draft
Updated: 2026-04-02

This guide describes the local-only path for connecting Cursor to `caller-skill` through the MCP adapter.

Use `streamable_http` as the default Cursor transport.

## 1. Goal

After completing this setup, Cursor should be able to call these MCP tools:

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

The business truth remains in the local caller-skill HTTP surface. The MCP adapter only translates it into MCP tools.

## 2. Prerequisites

The local client runtime must already be running in local mode:

```bash
npm run ops -- start
```

Then fetch the MCP registration spec:

```bash
delexec-ops mcp spec
```

Expected result highlights:

- `preferred_transport = streamable_http`
- `streamable_http.url`
- `streamable_http.health_url`

Default local caller-skill HTTP base URL:

- `http://127.0.0.1:8091`

Default MCP health check:

- `http://127.0.0.1:8092/healthz`

## 3. Register it in Cursor

Use the `streamable_http.url` from `delexec-ops mcp spec`.

If Cursor already has an older `caller_skill` MCP entry, remove it first.

Then register the MCP server with:

- transport: `streamable_http`
- URL: `http://127.0.0.1:8092/mcp`

If your local runtime uses different ports, use the spec output instead of the default URL above.

## 4. Expected tool behavior

Cursor should see six tools.

Search and read phase:

- flexible order
- after reading a hotline, Cursor may go back to search if the selected hotline is not suitable

Execution phase:

- `read_hotline`
- `prepare_request`
- `send_request`
- `report_response`

Execution phase is strict.

`send_request` should only receive a `prepared_request_id`.

Polling should stay inside the adapter / caller-skill layer, not in the model.

## 5. First validation task

Use a local example hotline such as:

- `local.delegated-execution.workspace-summary.v1`

Validate that Cursor can:

1. find the hotline
2. read the hotline contract
3. prepare a request
4. send the prepared request
5. receive a terminal result

## 6. Current scope

This guide only covers:

- local mode
- Cursor via MCP

It does not yet cover:

- platform-mode supplier selection
- approval/review in `prepare_request`
- Cursor-specific UI affordances beyond MCP registration
