# Caller Skill MCP Adapter

This app exposes the local `caller-skill` HTTP truth surface as an MCP server over stdio.

Primary target hosts:

- Codex
- Cursor
- Claude Code in MCP-capable environments

The adapter does not implement hotline business logic. It only maps the caller-skill action surface into MCP tools.

## Exposed MCP tools

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

## Runtime requirements

The local caller-skill HTTP server must already be running.

Default base URL:

- `http://127.0.0.1:8091`

You can override it with:

- `CALLER_SKILL_BASE_URL`

## Start

From the repository root:

```bash
npm run caller-skill:mcp
```

Or directly:

```bash
node apps/caller-skill-mcp-adapter/src/server.js
```

## Environment variables

- `CALLER_SKILL_BASE_URL`
- `CALLER_SKILL_ADAPTER_PORT`
- `SKILL_ADAPTER_PORT`

Resolution order:

1. `CALLER_SKILL_BASE_URL`
2. `CALLER_SKILL_ADAPTER_PORT`
3. `SKILL_ADAPTER_PORT`
4. default `8091`

## Notes

- Polling remains inside caller-skill / adapter flow.
- `prepare_request` injects a stable adapter session id when the host does not provide one.
- This app is local-mode-first and does not add platform vendor selection logic.
