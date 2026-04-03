# Caller Skill MCP in Codex

Status: Draft
Updated: 2026-04-02

This guide describes the local-only path for connecting Codex to `caller-skill` through the MCP adapter.

Use `streamable_http` as the default Codex transport.

Keep `stdio` only as a fallback for local debugging.

## 1. Goal

After completing this setup, Codex should be able to call these MCP tools:

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

Expected local caller-skill HTTP base URL:

- `http://127.0.0.1:8091`

Verify:

```bash
curl http://127.0.0.1:8091/healthz
curl http://127.0.0.1:8091/skills/caller/manifest
```

## 3. Start the local runtime

From the repository root:

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

Verify:

```bash
curl http://127.0.0.1:8092/healthz
```

## 4. Register it in Codex

Before registering the new server, remove any old `caller_skill` stdio configuration:

```bash
codex mcp remove caller_skill
```

Then register the `streamable_http` MCP endpoint:

```bash
codex mcp add caller_skill --url http://127.0.0.1:8092/mcp
```

Use the exact URL returned by `delexec-ops mcp spec` if your ports differ.

## 5. Optional stdio fallback

From the repository root:

```bash
npm run caller-skill:mcp
```

If your local caller-skill server is on a non-default port:

```bash
CALLER_SKILL_BASE_URL=http://127.0.0.1:9191 npm run caller-skill:mcp
```

Register the MCP server as a stdio command only when `streamable_http` is unavailable:

```bash
node /absolute/path/to/repos/client/apps/caller-skill-mcp-adapter/src/server.js
```

Recommended environment:

- `CALLER_SKILL_BASE_URL=http://127.0.0.1:8091`

## 6. Expected tool behavior

Codex should see six tools.

Search and read phase:

- flexible order
- after reading a hotline, Codex may go back to search if the selected hotline is not suitable

Execution phase:

- `read_hotline`
- `prepare_request`
- `send_request`
- `report_response`

Execution phase is strict.

`send_request` should only receive a `prepared_request_id`.

Polling should stay inside the adapter / caller-skill layer, not in the model.

## 7. First validation task

Use a local example hotline such as:

- `local.delegated-execution.workspace-summary.v1`

Validate that Codex can:

1. find the hotline
2. read the hotline contract
3. prepare a request
4. send the prepared request
5. receive a terminal result

## 8. Current scope

This guide only covers:

- local mode
- Codex via MCP

It does not yet cover:

- platform-mode supplier selection
- approval/review in `prepare_request`
- Cursor-specific or Claude Code-specific host configuration details
