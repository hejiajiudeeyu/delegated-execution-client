# P-1 Client Implementation RFC: ops-console balance surface and ops CLI `tenant` group

> Chinese version: [./billing-p1-client-surface.zh-CN.md](./billing-p1-client-surface.zh-CN.md)
> Note: the Chinese version is the source of truth. This English mirror is provided for accessibility.

Status: Draft (implementation-layer; will freeze field names / hook contracts / CLI command names / error code handling)
Branch: `repos/client`
Companion reading:

- Protocol direction: `repos/protocol/docs/planned/design/billing-and-quota.md`
- Platform direction: `repos/platform/docs/planned/design/billing-design-rfc.md`
- Platform P-1 implementation: `repos/platform/docs/planned/design/billing-p1-tenant-balance-impl.md` (henceforth "platform P-1 RFC")
- Client direction (caller consent): `repos/client/docs/planned/design/billing-caller-consent.md` (henceforth "caller-consent direction RFC")

---

## 0. Up Front

This RFC is the **third piece** of the protocol/platform/client P-1 trio:

- The protocol direction RFC has fixed "there must be unified balance, quota windows, 5 auto-refund classes".
- The platform P-1 RFC has frozen 4 tables / 3 endpoints / 6 error codes / 4 monitoring metric IDs / 1 invariant daemon in the platform repo.
- This RFC freezes **the client-side surface that talks to the platform P-1 endpoints** in the client repo — i.e. what ops-console and `@delexec/ops` CLI can ship in P-1.

Its scope is **far narrower** than the caller-consent direction RFC:

| | caller-consent direction RFC | This RFC (client P-1 implementation) |
| :--- | :--- | :--- |
| Touchpoint coverage | caller-skill / ops-console / CLI / notifications (4 surfaces) | only ops-console + ops CLI (2 surfaces) |
| Consent gates | gate 1 (quote consent) + gate 2 (debit notification) | **neither** — P-1 has no quote, no hold/debit |
| Refund toasts | 5 classes | **none** — P-1 has no refunds |
| trust_tier rendering | required | **not rendered** — platform's trust_tier daemon ships in P-3 |
| Recharge entry point | wording must avoid fiat connotation | reuses the existing brand-site /pricing wording; this RFC does not move it |

The client's core stance for P-1:

> **In P-1 the client is a "balance observer", not a "billing participant"**. caller-skill / Agents / CLI keep firing calls and receiving results in P-1; balance is just a **read-only window**. The actual billing path (hold / debit / refund / quote) arrives in P-2.

Once this RFC lands:

- The balance surfaces in ops-console + their hook names + field mapping are frozen.
- The ops CLI `tenant balance` / `tenant ledger` command names + output schema are frozen.
- Subsequent stages (P-2 / P-3 / P-4) may **add** new touchpoints (e.g. quote drawer, refund toast) but may **not** rename the command / hook / field names frozen here.

Out of scope (still belong to P-2 and beyond):

- Preflight quote drawer / Agent prompt consent gate (P-2)
- 5 auto-refund toasts (P-2)
- trust_tier badge / disclaimer rendering (P-3)
- caller-skill MCP protocol-level billing claims (P-2)
- Recharge entry point implementation (separate RFC)

---

## 1. Scope and relation to v0.1 client

### 1.1 What P-1 client ships

Physical artifacts:

- ops-console: two new hooks `useTenantBalance()`, `useTenantLedger()` (§4)
- ops-console: a new `<TenantBalanceCard>` component pinned to the top of DashboardPage (§3)
- ops-console: a new `/balance` page (path frozen as `/balance`, no caller / responder prefix), rendering balance + ledger list (§3)
- ops CLI: a new `tenant` command group with two children: `tenant balance`, `tenant ledger` (§5)
- 6 client-side handling rules for the platform P-1 error codes (§7)

### 1.2 v0.1 client compatibility stance

Everything in this RFC is **additive** — no existing hook / page / CLI command changes external behaviour:

- caller-skill MCP server tool schema is **unchanged** (quote / billing claims belong to P-2).
- caller / responder v0.1 token flow is unchanged.
- DashboardPage drops no card; this RFC only **adds** a TenantBalanceCard.
- All existing ops CLI commands (`ui start`, `auth register`, `responder *`) are unchanged; this RFC only **adds** the `tenant` group.

After P-1 platform ships, old v0.1 clients keep working — they just can't see the balance and won't be balance-restricted (platform §5.4 default `hard_block_on_exceed=false` is operationally equivalent to "no balance" for old clients).

### 1.3 P-1 client release gates

The P-1 client is "done" when all four hold:

1. The two hooks + TenantBalanceCard + `/balance` page pass unit tests + end-to-end contract tests.
2. The two new ops CLI commands take the graceful path in local-only mode (no platform connection): no ENOENT, no stack trace (§5.4).
3. Platform P-1 RFC §1.3's 5 release gates are green; this RFC is not allowed to land before platform P-1 GA.
4. Documentation: `HelpPage.tsx`'s "Account & Balance" section is updated in lock-step (no new chapter; reuse existing structure).

---

## 2. Object overview

P-1 client introduces:

```
ops-console (apps/ops-console)
   └── src/hooks/
   │       ├── useTenantBalance.ts        ← single-tenant balance + 3 quota windows
   │       └── useTenantLedger.ts         ← keyset-paginated ledger pull
   │
   ├── src/components/billing/
   │       ├── TenantBalanceCard.tsx      ← top-of-Dashboard balance card
   │       └── LedgerList.tsx             ← balance-move list
   │
   └── src/pages/general/
           └── BalancePage.tsx            ← /balance route page

ops CLI (apps/ops)
   └── src/cli.js                         ← append a 'tenant' group branch
```

Each artefact's contract is frozen by the corresponding section.

---

## 3. ops-console balance surfaces

### 3.1 Route and navigation slot

- The route is frozen at `/balance` — not under `/caller/` or `/responder/`. Reason: balance itself is **not split between caller and responder** (this physically realises platform P-1 RFC §3.1).
- Add one nav item to the top navigation; copy is decided in the landing PR (caller-consent direction RFC §1.2 forbids fiat-connoting words such as "wallet" / "balance (USD)"); icon uses an existing token.
- Append a `<TenantBalanceCard>` to the top of DashboardPage (default collapsed: 1 line balance + 1 line quota progress); user expands to see quota detail. Do not render the ledger on DashboardPage.

### 3.2 BalancePage (`/balance`) structure

```
┌──────────────────────────────────────────────────────────────┐
│  TenantBalanceCard (expanded mode)                           │
│  - credit_balance_cents / pending_credit_cents               │
│  - 3 quota window progress bars (daily / monthly / total)    │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  LedgerList                                                  │
│  - default sort recorded_at desc, first 50 rows              │
│  - top: kind filter (multi-select chip) + since (date picker)│
│  - bottom: "Load more" button (keyset pagination)            │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  EmptyState (zero-ledger)                                    │
│  - Wording feel: "no balance moves yet" + link to brand-site │
│    /pricing for recharge instructions                        │
│  - Do NOT write "go top up" — caller-consent §1.2 forbids    │
│    fiat connotation                                          │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 TenantBalanceCard wording and field mapping

Frozen anchors (the actual copy is decided at landing PR; the anchor names are frozen):

| anchor | field mapping | feel |
| :--- | :--- | :--- |
| `balance.spendable.label` | `credit_balance_cents / 100` | primary balance (spendable) |
| `balance.pending.label` | `pending_credit_cents / 100` | secondary balance (not yet released) |
| `balance.window.daily.label` | `windows[kind=daily]` | daily window |
| `balance.window.monthly.label` | `windows[kind=monthly]` | monthly window |
| `balance.window.total.label` | `windows[kind=total]` | total window |

Forbidden to render directly:

- ❌ `version` (CAS version is platform-internal)
- ❌ `rate_limit_per_second` (rate limit is platform-internal, irrelevant to caller feel)
- ❌ `currency`'s value (P-1 only allows `PTS`; hard-code "PTS" in UI rather than tracking the schema)

### 3.4 Things explicitly NOT shipped in P-1

These behaviours are **explicitly omitted** in P-1 (P-2 will add them):

- Quote drawer at call-time (caller-consent direction RFC §3.2 gate 1)
- Debit toast / hold release toast (gate 2)
- 5 auto-refund toasts
- caller-skill MCP tool schema changes
- "When balance is insufficient, fall back to local mode" prefer toggle

To manually test "does the balance change?" in P-1, the only path is for ops admins to use `POST /v1/tenants/{tenant_id}/recharge` (platform P-1 RFC §4.3).

---

## 4. Hook contracts

### 4.1 `useTenantBalance()`

```ts
type TenantBalance = {
  tenantId: string;
  creditBalanceCents: number;
  pendingCreditCents: number;
  currency: "PTS";
  windows: Array<{
    kind: "daily" | "monthly" | "total";
    windowStartedAt: string;     // ISO 8601 UTC
    maxAmountCents: number | null;
    usedAsCallerCents: number;
    earnedAsResponderCents: number;
    hardBlockOnExceed: boolean;
  }>;
  rateLimitPerSecond: number;
  creditMode: "prepaid";
};

type UseTenantBalanceResult =
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: TenantBalance; error: null }
  | { state: "error"; data: null; error: ClientError };

declare function useTenantBalance(): UseTenantBalanceResult;
```

Frozen points:

- Hook name is `useTenantBalance`; **not** `useBalance` / `useWallet` / `useCallCredit` — the hook name mirrors the platform endpoint.
- Field names are `creditBalanceCents` / `pendingCreditCents` / `windows[].kind` etc. — one-to-one with platform P-1 RFC §4.1 response (snake → camel).
- `currency` literal is fixed to `"PTS"` in P-1; the union widens only when fiat ships.
- `creditMode` literal is fixed to `"prepaid"` in P-1; reserved for future `"postpaid_invoice"`.
- Return type is a discriminated union — callers must narrow on `state` first; we forbid bare `data?.creditBalanceCents` reads that flicker on render.
- Internally polls every 60s via `usePoll` (reuse existing `apps/ops-console/src/hooks/usePoll.ts`); the hook does not start its own timer loop.

### 4.2 `useTenantLedger(opts)`

```ts
type LedgerKind =
  | "hold" | "hold_release" | "debit" | "refund" | "credit"
  | "pending_credit_release" | "pending_credit_revoke"
  | "recharge" | "admin_adjustment";

type LedgerDirection = "caller_spend" | "responder_earn" | "system";

type LedgerRow = {
  ledgerId: string;
  kind: LedgerKind;
  direction: LedgerDirection;
  amountCents: number;
  requestId: string | null;
  quoteId: string | null;
  prevBalanceCents: number;
  newBalanceCents: number;
  prevPendingCreditCents: number;
  newPendingCreditCents: number;
  recordedAt: string;
};

type UseTenantLedgerOpts = {
  kinds?: LedgerKind[];
  since?: string | null;
  pageSize?: number;          // default 50, capped at 200
};

type UseTenantLedgerResult = {
  rows: LedgerRow[];
  hasMore: boolean;
  loadMore: () => void;       // pulls next page; idempotent during in-flight
  state: "loading" | "ready" | "error";
  error: ClientError | null;
};

declare function useTenantLedger(opts?: UseTenantLedgerOpts): UseTenantLedgerResult;
```

Frozen points:

- Default `pageSize = 50`, matching platform P-1 RFC §4.2's server default; also one-quarter of the endpoint cap of 200 to leave room for client-side experimentation.
- `kinds` filter encodes to the query string as repeated `?kind=` params, matching the endpoint contract.
- `loadMore()` is a no-op while in-flight (no double-tap → double fetch → double render).
- Hook does not persist cursor across mounts; every mount re-fetches from page one. If the user paginates to page 3, switches pages, and returns, they land on page 1 — a deliberate P-1 simplification (avoids persistent state).

### 4.3 `ClientError` shape

```ts
type ClientError = {
  code:
    | "ERR_TENANT_NOT_FOUND"
    | "ERR_BILLING_CURRENCY_UNSUPPORTED"   // client wouldn't trigger this; defensive only
    | "ERR_QUOTA_EXCEEDED"                  // P-1 hard_block default off; visible but rare
    | "ERR_BILLING_INTERNAL"
    | "ERR_NETWORK"                         // client-side: fetch throw / timeout / 5xx retries exhausted
    | "ERR_UNAUTHORIZED";                   // client-side: 401 / 403
  message: string;                          // user-facing localised copy
  retryable: boolean;
  raw?: unknown;                            // raw platform error body, only rendered in dev
};
```

Frozen points:

- `code` union may only contain those 6 values; P-2's new error codes (e.g. `ERR_QUOTE_EXPIRED`) are **added** to the union — never rename existing values.
- `retryable` is computed by the hook from platform `error.retryable` + the client-side network error type; callers don't infer it.

---

## 5. ops CLI `tenant` command group

### 5.1 Frozen command names

```
delexec tenant balance  [--json]
delexec tenant ledger   [--kind=<kind>]... [--since=<iso>] [--limit=<n>] [--json]
```

Frozen points:

- The group name is `tenant` — not `wallet` / `account` / `credit`; aligns with the platform endpoint namespace.
- Subcommands are `balance` / `ledger` — aligned with the hook names.
- Global flag: `--json` switches to machine-readable output (one JSON line per command); when omitted, output is TTY-friendly tabular.
- `--kind` is repeatable, mirroring the endpoint's `?kind=`; the short form `-k` is reserved (don't burn the single-letter namespace).

### 5.2 TTY-friendly output (default)

```
$ delexec tenant balance
balance:        50000 PTS  (pending 800 PTS)
daily window:   25000 / 100000 PTS    (caller 25000, responder earn 4000)
monthly window: 350000 / 2000000 PTS  (caller 350000, responder earn 60000)
total window:   1850000 / no cap      (caller 1850000, responder earn 320000)
```

```
$ delexec tenant ledger --limit=3
2026-05-06 10:31  debit         caller_spend     -50 PTS  req_01HFA1ZZZ
2026-05-06 09:55  recharge      system        +10000 PTS  rch_01HF...
2026-05-04 14:12  admin_adj.    system          -200 PTS  -
```

Frozen points:

- The unit is always `PTS` (TTY output never carries `cents`).
- Number precision: cents → PTS via integer division by 100 (floor); fractional remainder is preserved only in `--json`.
- Times render in the local timezone as `YYYY-MM-DD HH:mm`; `--json` returns ISO 8601 UTC.
- Column alignment uses ASCII spaces — **not** box-drawing characters (avoids garbling in plain terminals).

### 5.3 `--json` output (machine-readable)

```
$ delexec tenant balance --json
{"ok":true,"command":"tenant balance","data":{...same shape as endpoint response...}}
```

```
$ delexec tenant ledger --json --limit=3
{"ok":true,"command":"tenant ledger","data":{"items":[...],"hasMore":true,"nextCursor":"..."}}
```

Frozen points:

- Top-level shape `{ ok, command, data }` is the existing ops CLI's uniform shape; this RFC does not invent another.
- `data` passes through the platform endpoint response (snake → camel, in line with §4 hooks).
- Error path emits `{ ok: false, command, error: { code, message, retryable } }` and a non-zero exit code.

### 5.4 Graceful path when platform is unreachable

A P-1 client may be invoked in two environments:

- platform-attached: CLI calls platform endpoints.
- local-only mode (no platform): caller-skill still works on the local hotline runtime, but `tenant balance` / `tenant ledger` are meaningless.

P-1 freezes the local-only behaviour:

- exit code = 2 (distinct from success 0, generic error 1).
- TTY: "local-mode: no platform attached, so no tenant balance is available. Attach platform via brand-site docs, or ignore."
- `--json`: `{"ok":false,"command":"tenant balance","error":{"code":"ERR_LOCAL_MODE","message":"...","retryable":false}}`.
- No stack trace, no ENOENT, no stderr noise.

`ERR_LOCAL_MODE` is a P-1 client-internal error code; it is **not** in the §4.3 `ClientError.code` union (that union only carries values that come from the platform).

---

## 6. caller-skill MCP behaviour in P-1

### 6.1 Explicit no-op

caller-skill's MCP tool schema is **completely unchanged** in P-1:

- `delegated_call` tool input gains no `quoteId` / `maxChargeCents` / `consentToken` (P-2 work).
- `delegated_call` return envelope gains no `debit` / `refundClass` (P-2 work).
- No new MCP tool is introduced (`tenant_balance` etc. are **not** exposed as MCP tools to the Agent — Agents use ops CLI / ops-console).

### 6.2 The "balance feels invisible" design in P-1

With platform default `hard_block_on_exceed=false` (platform P-1 RFC §5.4), the caller-skill perspective in P-1 is:

- Calls go out as before; results return as before.
- No hold / debit ledger rows (P-2 only).
- No quota blocks (default off).
- No toast / Agent prompt consent gates.

caller-skill's docs gain a P-1 disclaimer:

> "P-1 doesn't deduct points. Agents calling hotlines won't consume your Call Credit; the actual billing path arrives in P-2."

The wording anchor sits at the top of caller-skill `apps/caller-skill/README.md`; this RFC does not freeze the exact wording.

### 6.3 Non-conflict with the caller-consent direction RFC

caller-consent direction RFC §2.1 mandates "two consent gates"; this RFC ships none — and that's **not a conflict**, because the direction RFC §0 says "the actual landing is governed by ops-console source + caller-skill prompts" and does not stipulate "P-1 must have gates".

If there's no quote in P-1, there's no object to consent to — the consent gate is a *necessary* condition once quote ships in P-2, not a *sufficient* one.

---

## 7. Error code handling on the client

| Platform code | Hook behaviour | CLI behaviour | User-facing feel |
| :--- | :--- | :--- | :--- |
| `ERR_TENANT_NOT_FOUND` | hook → error state | exit 1 + red copy | "Tenant not found; check platform registration" |
| `ERR_BILLING_CURRENCY_UNSUPPORTED` | hook → error state (defensive) | exit 1 | dev mode only (production won't trigger) |
| `ERR_QUOTA_EXCEEDED` | hook → error state + retry-after | exit 1 + retry hint | "Daily quota reached; retry after UTC 00:00 next day" |
| `ERR_BILLING_INTERNAL` | hook → error state, auto-retry once | exit 1 | "Platform internal error; retried once" — no stack |
| 401 / 403 | hook → `ERR_UNAUTHORIZED` | exit 3 | "Session expired or insufficient permissions" |
| network/timeout | hook → `ERR_NETWORK`, auto-retry 3× (exponential backoff) | exit 4 | "Network error; retried 3 times" |

Frozen points:

- exit code map (0 / 1 / 2 / 3 / 4) matches existing ops CLI conventions.
- Auto-retry only when `retryable=true`; other errors fail-fast.
- The client **does not** wrap `ERR_QUOTA_EXCEEDED` into a "go top up!" CTA — recharge in P-1 is an ops job, not a user action (caller-consent direction RFC §1.2 forbids fiat connotation).

---

## 8. Test & release matrix

### 8.1 Unit test coverage (P-1 client release gate #1)

At minimum:

- `useTenantBalance` three states (loading / ready / error) render snapshots
- `useTenantLedger` `loadMore` idempotency: double-tap during in-flight fires only one fetch
- `useTenantLedger` kinds filter encodes the query string correctly (with repeated params)
- `<TenantBalanceCard>` toggle preserves props
- `BalancePage` zero-ledger state renders EmptyState rather than blank
- ops CLI `tenant balance` / `tenant ledger` behaviour for "platform 200 / 404 / 5xx / network down" — stdout + exit code

### 8.2 Contract tests (end-to-end)

- Run a happy path against platform staging: `POST /v1/tenants/{id}/recharge`, then `useTenantBalance` reads it, then `useTenantLedger` shows that row.
- Verify hook field mapping is identical to §4.1 / §4.2.
- Verify CLI `--json` output matches §5.3 exactly.

### 8.3 Rollout strategy

P-1 client GA path:

- shadow: ops-console internal users dogfood for 7 days; monitor that console error rate doesn't rise.
- public: ship alongside platform P-1 GA; nav item gracefully hides when platform is unavailable (§5.4 ERR_LOCAL_MODE).

### 8.4 Rollback path

- Pulling `/balance` route + nav item + the DashboardPage `<TenantBalanceCard>` reverts old users to P-0 feel.
- ops CLI hides the `tenant` group (commands still exist but are not listed in `--help`); old scripts keep working.

---

## 9. Edge cases and known compromises

### 9.1 Where `tenant_id` comes from

- ops-console: read from existing `useAuth` session — **never** ask the user to type a tenant_id in the UI.
- ops CLI: read from local `~/.delexec/credentials.json`; missing → §5.4 `ERR_LOCAL_MODE`.

### 9.2 Cross-caller / cross-responder balance view

Unified balance is a hard requirement of platform P-1 RFC §3.1; the client honours it:

- A single `<TenantBalanceCard>` serves both caller and responder views — no tabs.
- LedgerList mixes `caller_spend` / `responder_earn` / `system` directions by default; only `--kind` filter splits them.
- DashboardPage does not show "caller-side balance" / "responder-side balance" panes — that would suggest the balances are split.

### 9.3 `pending_credit_cents` in P-1

- Platform P-1 RFC reserves the column, but P-1 has **no** write path that touches it (`pending_credit_release` / `pending_credit_revoke` are P-3 trust_tier daemon writes).
- The client must **not** assume it's always 0 — the field is typed `number`; the UI renders it explicitly when `pending > 0` (no happy-path "hide if zero" trick that explodes when non-zero arrives).
- Wording anchor `balance.pending.label` only needs final wording in P-3 (when trust_tier hits the UI); P-1 may use placeholder copy "unreleased points".

### 9.4 Polling frequency vs. server load

- `useTenantBalance` polls every 60s; `useTenantLedger` does not poll, fetching only on mount + `loadMore()`.
- `<TenantBalanceCard>` mounts once per session (top of DashboardPage); the `/balance` page reuses the same hook instance (no separate fetcher).
- This sits well below platform P-1 RFC §4.1's `rate_limit_per_second: 2` — leaves headroom for P-2's quote / debit reads.

### 9.5 Offline / dev mode

- In `pnpm run dev` with `VITE_OFFLINE=1`, hooks return mock data; mock data must strictly match §4.1 / §4.2 schema.
- Mock data is **not** committed to git (dev-only temporary files), to prevent accidental prod render contamination.

---

## 10. Roadmap

P-1 client milestones (do not 1:1 with platform P-1 M1.x; must start after platform M1.4):

| Milestone | Theme | Unlocks |
| :--- | :--- | :--- |
| C1.1 | `useTenantBalance` + `<TenantBalanceCard>` (collapsed) | Top of DashboardPage shows the balance number |
| C1.2 | `/balance` page + expanded card + LedgerList | Users can see all 3 quota windows + ledger list |
| C1.3 | ops CLI `tenant` group | Scripts / Agent automation can read the balance |
| C1.4 | Error handling + graceful local-mode + HelpPage update | Release gate |

Each milestone requires:

- The previous one dogfooded in ops-console for 7 days.
- Unit test coverage in line with §8.1.
- Contract tests against platform staging passing.

---

## Appendix A: Field correspondence to platform P-1 RFC

| Platform P-1 RFC (snake) | This RFC (camel) | Status |
| :--- | :--- | :--- |
| `tenant_id` | `tenantId` | match |
| `credit_balance_cents` | `creditBalanceCents` | match |
| `pending_credit_cents` | `pendingCreditCents` | match |
| `currency` | `currency` | match; P-1 only literal `"PTS"` |
| `windows[].window_kind` | `windows[].kind` | shorter (drop `window_` prefix); literals identical |
| `windows[].window_started_at` | `windows[].windowStartedAt` | match |
| `windows[].max_amount_cents` | `windows[].maxAmountCents` | match; nullable preserved |
| `windows[].used_as_caller_cents` | `windows[].usedAsCallerCents` | match |
| `windows[].earned_as_responder_cents` | `windows[].earnedAsResponderCents` | match |
| `windows[].hard_block_on_exceed` | `windows[].hardBlockOnExceed` | match |
| `rate_limit_per_second` | `rateLimitPerSecond` | match; UI does not render |
| `credit_mode` | `creditMode` | match; P-1 only literal `"prepaid"` |
| `ledger_kind` enum | `LedgerKind` union | match; all 9 string values identical |
| `ledger_direction` enum | `LedgerDirection` union | match; all 3 string values identical |
| `next_cursor` | (consumed inside the hook; not exposed) | endpoint field; hook contract does not freeze it externally |

---

## Appendix B: Non-conflicts with caller-consent direction RFC

The following are **explicitly non-conflicts** with the caller-consent direction RFC:

- caller-consent §1.1's 5 touchpoints → this RFC covers only ops-console + ops CLI in P-1; the other 3 (caller-skill / Agent surface / notifications) stay as-is. This is a **progress** problem, not a **direction** problem.
- caller-consent §2.1's gate 1 / gate 2 → this RFC ships neither in P-1 because P-1 has no quote / no hold/debit; P-2 client implementation RFC will ship them once quote arrives.
- caller-consent §2.3's 4-class consent (max / disclaimer / remember / fallback to local) → none ship in P-1, same reason.
- caller-consent §1.2's anti-fiat connotation → this RFC complies in §3.1 / §7 (no "wallet"; `ERR_QUOTA_EXCEEDED` doesn't lead users to "go top up").

If P-2 introduces quote and any line above turns into a real conflict, the workflow is: first revise the caller-consent direction RFC via PR, *then* write the P-2 client implementation RFC. P-2 is forbidden to unilaterally override the direction RFC.

---

## Appendix C: References

- Protocol direction: `repos/protocol/docs/planned/design/billing-and-quota.md`
- Platform direction: `repos/platform/docs/planned/design/billing-design-rfc.md`
- Platform P-1 implementation: `repos/platform/docs/planned/design/billing-p1-tenant-balance-impl.md`
- Client direction: `repos/client/docs/planned/design/billing-caller-consent.md`
- Existing ops-console hook plumbing: `repos/client/apps/ops-console/src/hooks/useStatus.ts`, `usePoll.ts`
- Existing ops CLI entry: `repos/client/apps/ops/src/cli.js`
