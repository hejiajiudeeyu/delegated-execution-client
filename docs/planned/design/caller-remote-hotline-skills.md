# Caller Skill Design

Status: Planned
Updated: 2026-04-01

This document defines the next-step `caller-skill` design for agent access to hotline capabilities in `client`.

This is a caller-side design. It is not a responder runtime design, and it is not the end-user `ops` product flow. It describes the agent-facing bridge that sits above `caller-controller`.

Current scope:

- local mode only
- no platform vendor selection yet
- no protocol field changes

## 1. Goal

The agent should not learn the low-level caller protocol flow:

- search catalog
- inspect contract
- create request
- prepare
- dispatch
- poll
- read result

Instead, the agent should use a single caller-facing skill surface with progressive disclosure.

The intended layering is:

1. `caller-controller` remains the request lifecycle truth layer.
2. `caller-skill-adapter` remains the agent bridge.
3. `caller-skill` becomes the formal agent-facing interface.

## 2. Design Principles

### 2.1 Progressive disclosure

The agent should not read long catalogs or full hotline contracts too early.

The flow should progressively disclose information:

1. broad search
2. narrow comparison
3. full contract read
4. request preparation
5. send
6. result report

### 2.2 Search and read are flexible

The search and read phase is intentionally not a single rigid sequence.

The agent may:

- do one brief search, then one detailed search
- do multiple brief searches before narrowing
- read one hotline, then go back to search
- read several hotlines before deciding

If the agent is not satisfied after reading a hotline, it should explicitly be allowed to go back to:

- `search_hotlines_brief`
- `search_hotlines_detailed`

### 2.3 Request execution is strict

Once the agent decides to actually send work, the flow must become strict:

1. `read_hotline`
2. `prepare_request`
3. `send_request`
4. `report_response`

The agent must not bypass `prepare_request`.

### 2.4 The adapter owns polling

The adapter, not the model, should own request polling by default.

For normal local-mode calls:

- `send_request` sends the prepared request
- the adapter polls until terminal state
- the adapter returns a terminal response to the agent

This keeps protocol control logic out of the model.

## 3. Caller Skill Surface

The first complete surface should expose six actions:

1. `search_hotlines_brief`
2. `search_hotlines_detailed`
3. `read_hotline`
4. `prepare_request`
5. `send_request`
6. `report_response`

## 4. Interface Definitions

## 4.1 `search_hotlines_brief`

Purpose:

- fuzzy narrowing from a large hotline space into a short candidate list

Input:

```json
{
  "query": "summarize workspace repository",
  "task_goal": "find a local hotline that can summarize a workspace",
  "task_type": "text_summarize",
  "limit": 8
}
```

Output:

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

Notes:

- return cards, not full contracts
- optimized for low context cost

## 4.2 `search_hotlines_detailed`

Purpose:

- compare a small candidate set in more detail before selection

Input:

```json
{
  "hotline_ids": [
    "local.delegated-execution.workspace-summary.v1"
  ]
}
```

Output:

```json
{
  "items": [
    {
      "hotline_id": "local.delegated-execution.workspace-summary.v1",
      "display_name": "Workspace Summary",
      "description": "Summarize a workspace using local runtime",
      "input_summary": "Provide the workspace path and question",
      "output_summary": "Returns a structured summary result",
      "task_types": ["text_summarize"],
      "draft_ready": true,
      "local_only": true,
      "review_status": "local_only"
    }
  ]
}
```

Notes:

- this is still selection support, not full request preparation
- the agent may return to brief search after this step

## 4.3 `read_hotline`

Purpose:

- read the selected hotline contract and caller-facing template

Input:

```json
{
  "hotline_id": "local.delegated-execution.workspace-summary.v1"
}
```

Output:

```json
{
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "display_name": "Workspace Summary",
  "input_summary": "Provide workspace_path and question",
  "output_summary": "Returns structured summary output",
  "input_schema": {
    "type": "object",
    "required": ["workspace_path", "question"],
    "properties": {
      "workspace_path": {
        "type": "string",
        "description": "Absolute path to the workspace to inspect"
      },
      "question": {
        "type": "string",
        "description": "What the hotline should summarize or answer"
      }
    }
  },
  "output_schema": {
    "type": "object"
  }
}
```

Notes:

- this is the point where the agent enters the fill/preparation stage
- if the agent decides the hotline is not suitable, it may go back to step 1 or 2

## 4.4 `prepare_request`

Purpose:

- validate and normalize candidate input against the hotline template before sending

This step is mandatory.

Input:

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

Output when invalid:

```json
{
  "prepared_request_id": "prep_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "draft",
  "normalized_input": {
    "workspace_path": "/tmp/demo"
  },
  "errors": [
    {
      "field": "question",
      "code": "REQUIRED_FIELD_MISSING",
      "message": "question is required"
    }
  ],
  "warnings": [],
  "review": {
    "required": false,
    "status": "not_required"
  },
  "expires_at": "2026-04-02T12:00:00Z"
}
```

Output when valid:

```json
{
  "prepared_request_id": "prep_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "ready",
  "normalized_input": {
    "workspace_path": "/tmp/demo",
    "question": "Summarize the repo structure"
  },
  "errors": [],
  "warnings": [],
  "review": {
    "required": false,
    "status": "not_required"
  },
  "expires_at": "2026-04-02T12:00:00Z"
}
```

Validation responsibilities:

- required field missing
- unexpected field
- wrong type
- enum mismatch
- malformed string/format
- obvious empty value
- length/range violation

Future extension point:

- call review / approval checks should hook into `prepare_request`

## 4.5 `send_request`

Purpose:

- send a request that has already passed preparation

`send_request` should directly reuse the prepared content and should not accept raw user input.

Input:

```json
{
  "prepared_request_id": "prep_123",
  "wait": true
}
```

Output when `wait=true`:

```json
{
  "request_id": "req_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "SUCCEEDED",
  "result": {
    "summary": "..."
  },
  "result_package": {
    "status": "ok",
    "output": {
      "summary": "..."
    }
  },
  "error": null
}
```

Output when `wait=false`:

```json
{
  "request_id": "req_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "PENDING"
}
```

Rules:

- only `status=ready` prepared requests may be sent
- the adapter reuses the stored normalized input
- the adapter marks the prepared request as `sent`

## 4.6 `report_response`

Purpose:

- read and normalize terminal request state for agent consumption

Input:

```json
{
  "request_id": "req_123"
}
```

Output:

```json
{
  "request_id": "req_123",
  "status": "SUCCEEDED",
  "result": {
    "summary": "..."
  },
  "result_package": {
    "status": "ok",
    "output": {
      "summary": "..."
    }
  },
  "error": null,
  "human_summary": "Workspace summary completed successfully"
}
```

Notes:

- if `send_request(wait=true)` already returned a terminal result, `report_response` may be implemented as an internal step
- if `wait=false`, `report_response` becomes the explicit follow-up action

## 5. Prepared Request Persistence

`prepare_request` should persist a short-lived local object called `prepared_request`.

This is not a protocol truth layer. It is local caller-skill state.

Recommended storage:

- `DELEXEC_HOME/prepared-requests/`

Recommended file form:

- one file per prepared request
- example:
  - `DELEXEC_HOME/prepared-requests/prep_123.json`

## 5.1 State Model

Allowed states:

- `draft`
- `ready`
- `sent`
- `expired`
- `invalidated`

Meaning:

- `draft`: parsed but not valid for send
- `ready`: validated and sendable
- `sent`: already bound to a real `request_id`
- `expired`: TTL expired
- `invalidated`: replaced by a newer prepared version

## 5.2 Suggested Record Shape

```json
{
  "prepared_request_id": "prep_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "ready",
  "normalized_input": {},
  "errors": [],
  "warnings": [],
  "review": {
    "required": false,
    "status": "not_required"
  },
  "request_id": null,
  "created_at": "2026-04-01T12:00:00Z",
  "updated_at": "2026-04-01T12:00:00Z",
  "expires_at": "2026-04-02T12:00:00Z",
  "source_agent_session_id": "agent_123"
}
```

## 5.3 Cleanup Rules

Suggested cleanup strategy:

1. TTL expiration
   - `draft` and `ready` expire after a short TTL
2. send invalidation
   - once sent, the record becomes `sent`
3. replacement invalidation
   - newer prepare results for the same work may invalidate older pending ones
4. periodic GC
   - delete old `sent`, `expired`, and `invalidated` records after retention

## 6. Orchestration Rules

Search and read phases do not require a single fixed order.

Allowed patterns:

- brief search -> detailed search -> read
- brief search -> read -> back to brief search
- brief search -> detailed search -> read -> back to detailed search

But request execution is mandatory and linear:

1. `read_hotline`
2. `prepare_request`
3. `send_request`
4. `report_response`

The agent must not send directly from search results.

## 7. Polling Policy

Default policy:

- the adapter polls
- the agent does not poll

Reason:

- polling is deterministic control logic
- it should not consume model context
- it keeps the agent focused on task-level reasoning

Terminal states:

- `SUCCEEDED`
- `FAILED`
- `UNVERIFIED`
- `TIMED_OUT`

## 8. Local Mode vs Platform Mode

This design is for local mode only.

Local mode selection focuses on:

- capability fit
- contract fit
- local availability

Platform mode should later expand the detailed search/read phase with vendor selection factors:

- responder quality
- hotline operational performance
- success rate
- latency
- specialization
- review status
- service quality / SLA

That is out of scope for this document.

## 9. Mapping to Existing Implementation

The intended implementation base is still:

- [apps/caller-skill-adapter/src/server.js](/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/apps/caller-skill-adapter/src/server.js)
- [packages/caller-controller-core/src/index.js](/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/packages/caller-controller-core/src/index.js)

Existing endpoints that can be reused:

- `GET /skills/remote-hotline/catalog`
- `POST /skills/remote-hotline/invoke`
- `GET /skills/remote-hotline/requests/:requestId`

Recommended next change:

- refactor the existing `remote-hotline` surface into the six progressive-disclosure actions defined here

## 10. Acceptance Criteria

The caller-skill layer is only considered complete for local mode when:

1. an agent can narrow hotline candidates with low context cost
2. an agent can compare a small set in more detail
3. an agent can read the selected hotline contract
4. an agent can prepare and validate request input
5. an agent can send only prepared input
6. the adapter can poll to terminal state automatically
7. the agent can consume the returned result and continue work
8. the full chain works without platform
