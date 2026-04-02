# OpenClaw Adapter Guide

Status: Draft
Updated: 2026-04-02

This document explains how to adapt `client` caller-side hotline capability into an OpenClaw-friendly skill.

This document is aligned with the new local-mode `caller-skill` design. It no longer assumes the older `remote-hotline` three-endpoint shape as the primary contract.

## 1. Goal

OpenClaw should not learn the low-level caller request protocol.

Instead:

1. OpenClaw should see one stable caller-side skill surface.
2. The bridge should own request orchestration.
3. OpenClaw should receive normalized results, not protocol noise.

## 2. Why OpenClaw Needs a Bridge

OpenClaw skill integration is naturally better at calling a high-level capability endpoint than a multi-step controller workflow.

If OpenClaw directly called caller-controller APIs, the model would have to own:

- request lifecycle sequencing
- request id management
- retries and wait strategy
- protocol-specific result handling

That should stay in code, not in the model.

## 3. Recommended Shape

### 3.1 One stable skill surface

Prefer one stable caller-side skill:

- `caller-skill`

Do not expose many responder-specific skill names.

### 3.2 Progressive disclosure

The bridge should expose a progressive-disclosure action set:

1. `search_hotlines_brief`
2. `search_hotlines_detailed`
3. `read_hotline`
4. `prepare_request`
5. `send_request`
6. `report_response`

The search/read phase is flexible.

The execution phase is strict:

1. `read_hotline`
2. `prepare_request`
3. `send_request`
4. `report_response`

If OpenClaw reads a hotline and decides it is not suitable, it should be allowed to go back to:

- `search_hotlines_brief`
- `search_hotlines_detailed`

## 4. OpenClaw Configuration Suggestion

OpenClaw-specific config depends on the host environment, but the bridge should conceptually point to:

- base URL: `http://127.0.0.1:8091/skills/caller`

Recommended entry points:

- `GET /skills/caller/manifest`
- `POST /skills/caller/search-hotlines-brief`
- `POST /skills/caller/search-hotlines-detailed`
- `GET /skills/caller/hotlines/:hotlineId`
- `POST /skills/caller/prepare-request`
- `POST /skills/caller/send-request`
- `GET /skills/caller/requests/:requestId/report`

The bridge should not expose responder secrets or protocol-only details.

## 5. Action Semantics

### 5.1 `search_hotlines_brief`

Use for broad narrowing.

Return:

- `hotline_id`
- `display_name`
- `short_description`
- `task_types`
- `match_reason`
- `score`

### 5.2 `search_hotlines_detailed`

Use for comparing a small shortlist.

Return richer metadata:

- `description`
- `input_summary`
- `output_summary`
- `draft_ready`
- `local_only`
- `review_status`

### 5.3 `read_hotline`

Use once a hotline is selected.

Return:

- input schema
- output schema
- field descriptions
- local draft information

### 5.4 `prepare_request`

Use before every send.

The bridge should:

- read the hotline template
- compare candidate input with the schema
- validate and normalize fields
- persist a short-lived prepared request

This is also the correct future hook for:

- review
- approval
- risk checks

### 5.5 `send_request`

Use only with a `prepared_request_id`.

The bridge should:

- reuse prepared normalized input
- send via caller-side request flow
- by default poll until terminal state

### 5.6 `report_response`

Use to normalize the final request outcome for the model.

Return:

- `status`
- `result`
- `result_package`
- `error`
- optional `human_summary`

## 6. Polling Strategy

By default, the adapter should poll.

OpenClaw should not poll request status itself for normal local-mode calls.

Reason:

- polling is deterministic orchestration logic
- it should not spend model context
- the bridge can return the terminal state directly

## 7. Mapping to Current Repository

The OpenClaw-friendly surface should build on:

- [apps/caller-skill-adapter/src/server.js](/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/apps/caller-skill-adapter/src/server.js)
- [packages/caller-controller-core/src/index.js](/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/packages/caller-controller-core/src/index.js)

The bridge should use the caller-skill action surface, not raw caller-controller routes.

## 8. Prompt Guidance

The OpenClaw-side prompt should instruct:

- use `caller-skill` when a task can be handled by a hotline
- do not manually compose caller-controller HTTP steps
- return structured results rather than protocol details
- if a read hotline does not fit, go back to search

## 9. Current Boundary

The repository now contains a local-mode caller-skill action surface, but it does not yet ship a dedicated OpenClaw registration package or OpenClaw-specific bridge app.

That means:

- the agent-facing contract now exists
- actual OpenClaw registration is still a follow-up step
