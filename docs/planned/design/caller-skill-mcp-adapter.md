# Caller Skill MCP Adapter

Status: Draft
Updated: 2026-04-02

This document defines the MCP adapter layer for exposing `caller-skill` to MCP-capable agent hosts.

Primary target hosts:

- Codex
- Cursor
- Claude Code, when MCP is available in that runtime

This document does not redefine caller-side hotline business logic. It only specifies how the existing caller-skill truth surface should be mapped into MCP tools.

## 1. Goal

The MCP adapter should allow MCP-capable agents to use `caller-skill` without learning caller-controller HTTP routes.

The adapter should:

1. consume the caller-skill HTTP truth surface
2. expose stable MCP tools
3. preserve progressive disclosure
4. keep polling inside the adapter / truth layer

It should not:

- duplicate hotline business logic
- duplicate request orchestration logic
- reimplement schema validation rules

## 2. Position in the Architecture

The MCP adapter sits between:

- `caller-skill-adapter` as the caller-side truth surface
- an MCP-capable host such as Codex or Cursor

Layering:

1. `caller-skill-adapter` provides HTTP truth + manifest
2. `caller-skill-mcp-adapter` translates it into MCP tools
3. the host registers and calls those MCP tools

## 3. Why MCP First

MCP should be the first host adapter family because a single MCP adapter can likely cover:

- Codex
- Cursor
- Claude Code in MCP-capable environments

This gives the best coverage with the least duplication.

## 4. Source of Truth

The MCP adapter must treat the following as truth:

- `GET /skills/caller/manifest`
- `POST /skills/caller/search-hotlines-brief`
- `POST /skills/caller/search-hotlines-detailed`
- `GET /skills/caller/hotlines/:hotlineId`
- `POST /skills/caller/prepare-request`
- `POST /skills/caller/send-request`
- `GET /skills/caller/requests/:requestId/report`

The MCP adapter should not bypass these routes by directly calling caller-controller routes, except for health/debug internals when needed.

## 5. Tool Mapping

The MCP adapter should expose one MCP tool per caller-skill action.

Canonical tool names:

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

## 5.1 `caller_skill.search_hotlines_brief`

Maps to:

- `POST /skills/caller/search-hotlines-brief`

Purpose:

- broad fuzzy narrowing of hotline candidates

MCP input shape:

```json
{
  "query": "summarize workspace repository",
  "task_goal": "find a local hotline that can summarize a workspace",
  "task_type": "text_summarize",
  "limit": 8
}
```

MCP output shape:

```json
{
  "items": [
    {
      "hotline_id": "local.delegated-execution.workspace-summary.v1",
      "display_name": "Workspace Summary",
      "short_description": "Summarize a local workspace repository",
      "task_types": ["text_summarize"],
      "source": "local",
      "match_reason": "matches workspace + summarize",
      "score": 0.94
    }
  ]
}
```

## 5.2 `caller_skill.search_hotlines_detailed`

Maps to:

- `POST /skills/caller/search-hotlines-detailed`

Purpose:

- compare a small shortlist before selection

MCP input shape:

```json
{
  "hotline_ids": [
    "local.delegated-execution.workspace-summary.v1"
  ]
}
```

## 5.3 `caller_skill.read_hotline`

Maps to:

- `GET /skills/caller/hotlines/:hotlineId`

Purpose:

- read the selected hotline contract and template

MCP input shape:

```json
{
  "hotline_id": "local.delegated-execution.workspace-summary.v1"
}
```

## 5.4 `caller_skill.prepare_request`

Maps to:

- `POST /skills/caller/prepare-request`

Purpose:

- validate and normalize candidate request input

MCP input shape:

```json
{
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "input": {
    "workspace_path": "/tmp/demo",
    "question": "Summarize the repo structure"
  },
  "agent_session_id": "agent_123"
}
```

Notes:

- `agent_session_id` should be supplied by the MCP host adapter when possible
- if the host does not expose a stable session id, the adapter may synthesize one

## 5.5 `caller_skill.send_request`

Maps to:

- `POST /skills/caller/send-request`

Purpose:

- send a prepared request and, by default, wait for terminal state

MCP input shape:

```json
{
  "prepared_request_id": "prep_123",
  "wait": true
}
```

Default behavior:

- `wait=true`

Reason:

- local-mode calls should normally return terminal state directly
- polling should remain in the adapter layer, not in the model

## 5.6 `caller_skill.report_response`

Maps to:

- `GET /skills/caller/requests/:requestId/report`

Purpose:

- read and normalize request state

This tool is mainly needed for:

- explicit asynchronous paths
- retries
- recovery after host interruption

## 6. Manifest Translation

The MCP adapter should use `GET /skills/caller/manifest` as its own registration source.

The translation rules should be:

1. each manifest action becomes one MCP tool
2. the canonical action name becomes the MCP tool name
3. action description becomes the MCP tool description
4. orchestration rules become host-facing guidance or adapter metadata

Recommended mapping:

- `manifest.skill.name` -> MCP server metadata
- `manifest.actions[]` -> MCP tool registry
- `manifest.orchestration.execution_phase_order` -> adapter guidance
- `manifest.orchestration.go_back_after_read_to` -> adapter guidance
- `manifest.orchestration.polling_owner` -> tool runtime behavior

## 7. Host Behavior Guidance

The MCP adapter should surface this behavioral guidance consistently to MCP hosts:

- search and read phase is flexible
- execution phase is strict
- after reading a hotline, the agent may go back to search if it is not satisfied
- `prepare_request` is mandatory before `send_request`
- polling is owned by the adapter / truth layer

This guidance should be encoded in:

- MCP tool descriptions
- server metadata
- optional host-side prompt snippets

## 8. Error Mapping

The MCP adapter should preserve structured errors from caller-skill and return them as structured tool errors where possible.

Examples:

- `HOTLINE_NOT_FOUND`
- `HOTLINE_DRAFT_NOT_FOUND`
- `PREPARED_REQUEST_NOT_FOUND`
- `PREPARED_REQUEST_NOT_READY`
- `PREPARED_REQUEST_EXPIRED`

The adapter should not rewrite them into vague host-specific strings unless the host requires a simplified form.

## 9. Session Identity

Some caller-skill actions benefit from an agent session id:

- especially `prepare_request`

The MCP adapter should support a stable session identifier strategy:

1. use a host-provided session id if available
2. otherwise derive a stable local session id
3. keep that value stable for the current host conversation/session

This enables:

- invalidating older prepared requests
- future audit/review hooks

## 10. Long-Running and Recovery Paths

Even though the default is `wait=true`, the MCP adapter should preserve a recovery path for longer tasks.

Recommended behavior:

- default `send_request(wait=true)`
- allow `wait=false` when explicitly requested
- use `report_response` for recovery or later resumption

This allows the MCP host to handle interruptions without exposing protocol polling details to the model.

## 11. Implementation Shape

Recommended implementation:

- one dedicated MCP server for caller-skill
- the MCP server internally calls the caller-skill HTTP truth surface

Suggested future location:

- `apps/caller-skill-mcp-adapter/`

This keeps:

- HTTP truth layer separate
- MCP mapping separate
- host profiles separate

## 12. First Acceptance Target

The first concrete acceptance target should be Codex.

Successful Codex acceptance means:

1. Codex sees the six MCP tools
2. Codex can search candidate hotlines
3. Codex can read a hotline contract
4. Codex can prepare a request
5. Codex can send it
6. Codex can consume the terminal result

After Codex passes, Cursor should reuse the same MCP adapter with minimal extra work.

## 13. Out of Scope

Not included in this document:

- platform-mode supplier selection
- OpenClaw-specific HTTP host profile details
- Claude Code CLI wrapper specifics
- approval workflows in `prepare_request`

Those are follow-up documents.
