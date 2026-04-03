# Caller Skill Host Adapters

Status: Draft
Updated: 2026-04-02

This document defines how `caller-skill` should be exposed to multiple agent hosts such as Codex, Claude Code, Cursor, and OpenClaw.

This document does not redefine caller-skill business logic. It only defines the host adapter architecture for delivering the existing caller-skill surface into different agent environments.

## 1. Goal

The system should support multiple agent hosts without duplicating hotline business logic.

Supported target environments include:

- Codex
- Claude Code
- Cursor
- OpenClaw

The design goal is:

1. one caller-side truth surface
2. thin host-specific adapters
3. thin host-specific configuration

## 2. Design Principle

Do not build one bridge per product if the real difference is only tool registration.

Do not build:

- `codex-bridge`
- `cursor-bridge`
- `claude-code-bridge`
- `openclaw-bridge`

as four separate business implementations.

Instead, split the system into three layers:

1. caller-skill truth layer
2. host adapter layer
3. host profile layer

## 3. Three-Layer Architecture

## 3.1 Truth layer: `caller-skill-adapter`

This is the single business truth for caller-side hotline skill access.

It owns:

- the progressive-disclosure action model
- local-mode hotline read/prepare/send/report logic
- request orchestration
- polling
- prepared request persistence

Its surface is:

- `GET /skills/caller/manifest`
- `POST /skills/caller/search-hotlines-brief`
- `POST /skills/caller/search-hotlines-detailed`
- `GET /skills/caller/hotlines/:hotlineId`
- `POST /skills/caller/prepare-request`
- `POST /skills/caller/send-request`
- `GET /skills/caller/requests/:requestId/report`

This layer must remain host-neutral.

## 3.2 Host adapter layer

This layer translates the caller-skill truth surface into a host-specific tool transport.

Recommended adapter families:

- HTTP skill adapter
- MCP adapter
- CLI adapter

Each adapter should remain thin and avoid owning hotline business logic.

## 3.3 Host profile layer

This layer is product-specific configuration.

Each host profile should only define:

- how that host registers tools
- base URL or MCP server endpoint
- tool naming and description hints
- host-specific prompt guidance

It must not duplicate validation, request flow, or result handling logic.

## 4. Adapter Families

## 4.1 HTTP skill adapter

Use when a host naturally consumes a fixed HTTP skill endpoint.

Typical fit:

- OpenClaw

Responsibilities:

- expose caller-skill actions as stable HTTP endpoints
- serve a manifest or equivalent discovery contract
- preserve progressive disclosure

Non-responsibilities:

- caller business logic
- hotline selection heuristics as product logic

## 4.2 MCP adapter

Use when a host naturally consumes MCP tools.

Typical fit:

- Codex
- Cursor
- possibly Claude Code, if MCP is available in that environment

Responsibilities:

- map each caller-skill action to one MCP tool
- expose the action metadata from the caller-skill manifest
- keep the caller-skill action names stable

Recommended tool names:

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

## 4.3 CLI adapter

Use when a host is better at invoking local commands or wrapper scripts than HTTP or MCP.

Typical fit:

- Claude Code in environments where MCP is unavailable or inconvenient

Responsibilities:

- provide a local command wrapper around the caller-skill action surface
- preserve the same action semantics

This is a fallback adapter family, not the preferred first target if MCP is available.

## 5. Host Mapping Recommendations

## 5.1 Codex

Preferred transport:

- MCP via `streamable_http`

Reason:

- Codex naturally works well with tool-like interfaces
- MCP allows stable multi-tool registration
- caller-skill actions already map cleanly to discrete tools

Recommendation:

- build a `caller-skill` MCP adapter
- prefer `streamable_http` registration over stdio for real Codex validation
- register the six actions as MCP tools

## 5.2 Cursor

Preferred transport:

- MCP via `streamable_http`

Reason:

- same action decomposition works well
- likely can reuse the same MCP adapter as Codex

Recommendation:

- do not build a Cursor-specific business bridge
- reuse the same MCP adapter and define only a Cursor host profile
- use the same `streamable_http` registration path as Codex by default

## 5.3 Claude Code

Preferred transport:

- MCP if supported
- otherwise CLI adapter

Recommendation:

- try to keep Claude Code on the same MCP path as Codex/Cursor
- only fall back to CLI when MCP is not viable in that runtime

## 5.4 OpenClaw

Preferred transport:

- HTTP skill adapter

Reason:

- OpenClaw naturally fits a fixed `baseUrl` + HTTP skill model
- it does not need a second layer if the caller-skill HTTP surface is already stable

Recommendation:

- point OpenClaw to the caller-skill HTTP contract
- use the manifest to document the action set

## 6. Why This Split Is Better

This split avoids four forms of duplication:

1. duplicated hotline search logic
2. duplicated preparation and validation logic
3. duplicated request orchestration logic
4. duplicated result normalization logic

Only tool registration and transport mapping should vary by host.

## 7. Manifest Requirements

The caller-skill manifest should remain the handoff point between truth layer and host adapters.

It should describe:

1. skill metadata
2. action list
3. orchestration rules
4. host hints

Recommended host hint fields:

- `preferred_transport`
- `default_wait`
- `polling_owner`
- `supports_long_running`
- `input_size_limits`

These hints should help host adapters make registration decisions without changing business logic.

## 8. Tool Naming Rule

Across hosts, keep action names stable.

Recommended canonical names:

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

Avoid responder-specific or hotline-specific skill names as primary public entry points.

## 9. Prompt Guidance Rule

Host-specific prompts may differ slightly, but should all preserve the same behavioral guidance:

- search first
- read before prepare
- prepare before send
- go back to search if the selected hotline is not suitable
- let the adapter own polling

Prompt variations belong in host profiles, not in caller business logic.

## 10. Local Mode vs Platform Mode

This multi-host adapter design should first target local mode only.

In local mode, the host adapter only needs:

- hotline capability discovery
- contract reading
- request preparation
- request dispatch
- result reporting

In platform mode, host adapters will eventually need richer selection inputs such as:

- responder quality
- hotline operational performance
- success rate
- latency
- specialization
- review status
- SLA / service quality

That is a later extension and should not block the first multi-host rollout.

## 11. Suggested Implementation Sequence

Recommended order:

1. stabilize caller-skill HTTP truth surface
2. implement MCP adapter for Codex/Cursor
3. define OpenClaw HTTP host profile
4. define Claude Code host profile
5. run one real-agent end-to-end verification per host family

This sequence covers:

- Codex
- Cursor
- likely Claude Code
- OpenClaw

with minimum duplication.

## 12. Acceptance Criteria

This design is only considered realized when:

1. caller-skill remains the single caller-side truth surface
2. at least one MCP host can use it through a thin adapter
3. at least one HTTP skill host can use it through a thin adapter
4. no host-specific bridge duplicates hotline business logic
5. the same six caller-skill actions are visible across supported hosts
6. a real agent in at least one host can search, read, prepare, send, and consume results
