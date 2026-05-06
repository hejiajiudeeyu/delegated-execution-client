# Caller Consent — Caller-side Direction RFC

> Chinese version: [./billing-caller-consent.zh-CN.md](./billing-caller-consent.zh-CN.md)
> Note: the Chinese version is the source of truth. This English mirror is provided for accessibility.

Status: Direction-setting (no copy / field name / visual detail frozen)
Branch: `repos/client`
Companion reading:

- Protocol direction: `repos/protocol/docs/planned/design/billing-and-quota.md`
- Platform surface: `repos/platform/docs/planned/design/billing-design-rfc.md`
- Super-repo integration: the billing-rfc bundle (T6-4)

---

## 0. Up Front

This RFC does not explain "why we charge" — that is the protocol RFC. It does not explain "how the platform debits" — that is the platform RFC. It only answers one question:

> **On the caller side** — across `caller-skill` (MCP / Codex / Claude Code et al.), `apps/ops-console`, the `/help` content, and notification surfaces — what gets shown, what does the user have to consent to, when does the system interrupt the user, and when does it firmly **not** interrupt the user?

And one tight reverse-edge:

> **Callers must not be forced to "understand" the protocol-layer or platform-layer internal model.** Every consent point shown to a caller must be decidable in 5 seconds in the caller's own language — not by reading schema field names.

This RFC freezes **no** copy, field name, visual asset, or keyboard shortcut. Concrete landings will be source-of-truth in real ops-console pages and real caller-skill prompts.

---

## 1. Scope

### 1.1 Caller-side billing touchpoints

Caller-side billing touchpoints are naturally distributed across **multiple surfaces**. This RFC treats them as one design:

| Touchpoint | Location | Frequency |
| :--- | :--- | :--- |
| Agent invokes a hotline through caller-skill (MCP / SDK) | the `@delexec/caller-skill` MCP server | every call |
| ops-console "Try Call" drawer fires a call | `apps/ops-console/src/pages/caller/CatalogPage.tsx` | every manual try-call |
| ops-console approval centre approves a request | `apps/ops-console/src/pages/caller/CallerApprovalsPage.tsx` | every pending |
| caller-skill CLI directly fires a call | `apps/cli/src/commands/calls.js` etc. | every call |
| Balance / refund / billing-event notifications | console toasts / Agent surfaces | on debit / refund |

These five touchpoints must share **one** consent contract. Otherwise the user sees one thing in the Agent and a different one in the console, and immediately loses trust in the system.

### 1.2 Relation to protocol / platform RFCs

| Upstream hard requirement | Caller-side landing |
| :--- | :--- |
| Protocol §4.2 hotline self-reports + cap | UI translates `max_charge_cents` into "at most N points"; **never** exposes hotline-internal token / unit detail |
| Protocol §5.1 hold + single-debit | Debit is announced explicitly; holds do NOT pop up (avoid dialog fatigue) |
| Protocol §5.2 five auto-refund classes | Each refund toast carries a hand-off CTA; **never** make the caller think they need to file a dispute |
| Protocol §6 trust_tier | UI shows `trusted` / `verified` / `untrusted` / `frozen`; never reveals the internal score |
| Protocol §6.5 content review | Rejection → red toast + "auto-refunded"; **do not** render the masked content |
| Platform §4.1 preflight | Try-Call drawer / Agent prompt must obtain a quote and surface its cap **before** the call; "call now, tell later" is forbidden |
| Platform §10.4 no fiat | Recharge entry / pricing copy explicitly states "non-fiat, no withdrawal"; **never** use words like "balance", "wallet", or "withdraw" that connote fiat |

Any caller-side design that breaks this table is rejected.

### 1.3 Non-goals

- Final copy (e.g. "remaining N points" vs "will deduct N PTS" — left to landing PRs).
- Visual specifics (color / icon / radius — inherits the existing ops-console tokens).
- Picking platform's take rate / refund latency / recharge channels.
- A real-time metering panel (callers do not need a live point-burn graph; that is an ops surface).
- A new "global notifications centre" — console already uses `sonner`.

---

## 2. Hard requirements on the consent gates

### 2.1 Two consent gates per call

Caller consent = gate 1 (quote consent) + gate 2 (debit notification). Nothing else.

- **Gate 1 — quote consent before the call**: must appear in-line in the call-launching surface; must not hide behind a settings checkbox. `max_charge_cents` must be translated into a natural-language number ("at most 50 PTS"), never shown as a raw schema field.
- **Gate 2 — debit notification**: must appear in-line in the call's outcome surface; cannot be replaced by a banner. The actual debit amount must be a number, and must not be co-rendered in the same widget as `max` (avoid visual collapse).

Between gate 1 and gate 2, do **not** further interrupt the caller (no "your call is in progress, charging…" overlays).

### 2.2 Consent must be explicit and refusable

- Default-checked = treated as not consented (already enshrined in v0.1 protocol).
- "Remember this consent" applies only to the same hotline AND the same `max_charge_cents` threshold — never "click once, all hotlines auto-consented" (that is the `allow_all` approval mode, a different semantic).
- Refusing consent = the call flow terminates immediately; no ledger write, no request emitted.

### 2.3 Consent granularity

Callers see only four classes of decision:

1. **Price ceiling** (`max_charge_cents`) — must be seen on every call.
2. **Disclaimer** (medium / high risk hotlines) — must be seen for medium / high.
3. **"Remember this decision"** (per hotline + max_charge) — optional, default off.
4. **"Fall back to local mode if balance runs out"** — lives in preferences, not in the consent dialog.

Any "consent" outside those four belongs in the platform / protocol layer; it is not asked of the caller in this RFC.

---

## 3. Four caller touchpoints

### 3.1 caller-skill (MCP / SDK)

When an Agent (Codex / Claude Code etc.) invokes a hotline through caller-skill's MCP tool:

- caller-skill must **proactively include** a `pricing_summary` field in the tool signature returned to the Agent — `{"max_charge_cents": 50, "currency": "PTS", "pricing_model": "fixed_price"}`.
- The tool's prompt template must spell out: "Calling this hotline will deduct N points; subject to caller consent / caller whitelist."
- For medium / high risk hotlines, the tool signature must also include a `disclaimer.summary` field — single line, ≤ 80 characters.
- caller-skill **never** decides for the Agent whether to consent — it forwards the quote to the Agent, which (in manual mode) hands off to the caller console for a human decision.

### 3.2 ops-console "Try Call" drawer

When a human fires a call from CatalogPage's TryCallDrawer:

- The drawer fires a fire-and-forget call to platform's `/v1/preflight` the moment it opens.
- Right above the "Send call" button (snug to it), render **one** line:
  - "At most 50 PTS" (bold)
  - "(trusted hotline)" / "(untrusted · earnings settle in 7 days)" etc. as a modifier.
- For high-risk hotlines render a one-line red disclaimer summary right next to the line above.
- Not clicking "Send call" = treated as not consented = no request.
- The drawer **never** breaks the price down ("base + 0.5 ¢/sec" etc.) — those details belong on brand-site Pricing / `/help#pricing-models`.

### 3.3 ops-console approval centre

When an Agent's request lands in the caller approvals centre (CallerApprovalsPage):

- Each pending card's header already has RiskBadge / StatusBadge; add a "price chip" — `50 PTS · max`.
- The "Approve" button copy stays the same, but clicking "Approve" = **consenting to that one debit ceiling**.
- Approved cards (status=approved) get an extra "Charged: N points" line in the ExecutionBlock footer — that is gate 2.
- The whitelist popover (M6) stays as-is, with one new line: "Trust this hotline · future calls auto-pass quote" — making it clear that whitelisting ≠ auto-consent for arbitrary amounts; the caller's global preference cap (`max_charge_cents_per_call_default`, exact field decided at impl time) still bounds it.

### 3.4 caller-skill CLI

CLI users skew developer-y, but the consent gate is not simplified away:

- `delexec call <hotline_id> --input ...` prints a one-line quote before the call: "Quote: max 50 PTS, fixed_price" + waits for a return / `y`.
- A `--yes` shortcut is allowed, but the first time a user uses it, a warning prints: "--yes means you accept up to N points charge for any future call — confirm by re-running with `--yes-confirmed`" (double-confirmation pattern).
- On debit, print a single line "Charged: N PTS" (gate 2).
- On failure / refund, print a single line "Refunded: N PTS · reason=<code>" (one template across all five refund classes).

---

## 4. trust_tier rendering rules

### 4.1 Three display sites

| Location | Form | When |
| :--- | :--- | :--- |
| Catalog cards + detail | small chip · next to display name | always |
| Try-Call drawer quote line | inline modifier text | always |
| Approvals card header | chip next to RiskBadge | always |

### 4.2 Copy and color (direction, not frozen)

- `trusted`: default colour (slate / grey) — "trusted hotline".
- `verified`: green — "verified hotline".
- `untrusted`: amber — "untrusted · earnings settle later".
- `frozen`: red — "frozen, calls disabled" (and "Try Call" hidden).

### 4.3 Things never rendered

- The internal "trust score" number (e.g. 0.85) — protocol does not expose.
- "Last trust-tier change time" — callers do not need a hotline ops timeline.
- "How many more calls until the next tier" — that is the hotline's business; the caller is overreaching.

### 4.4 Behaviour on freeze

When any hotline transitions to `frozen`:

- Catalog card greys out, "Try Call" is disabled with a tooltip explaining why.
- Pending approvals against that hotline auto-expire (protocol mandate).
- Approved-but-not-yet-completed requests trigger `caller.request.refunded_hotline_frozen` per protocol §5.2; UI shows a red toast: "This hotline has been frozen — your call has been auto-refunded in full."
- Freeze is the incident path; no "how to appeal" link — that belongs in a brand-site announcement.

---

## 5. Preflight quote in the console

### 5.1 When to fetch

- Only the moment the caller "is clearly about to call": when TryCallDrawer opens, when CLI `delexec call` starts, when an Agent fetches the tool signature through caller-skill.
- **Do not** prefetch quotes for every Catalog card during browsing (too costly; quotes expire in 5 minutes anyway).
- Hold the quote_id in memory; on expiry, prompt to refetch — never silently auto-renew.

### 5.2 Quote-failure fallbacks

| Platform returns | UI behaviour |
| :--- | :--- |
| `ERR_BILLING_INTERNAL` | red toast + "Retry" button; do not block other Catalog browsing |
| `ERR_PREPAID_BALANCE_INSUFFICIENT` | amber banner + "Recharge" CTA + secondary link "Switch to local mode and continue" |
| `ERR_TRUST_TIER_LIMIT_EXCEEDED` | amber banner + "This hotline's per-call cap is below your max_charge setting — lower max_charge or pick a different hotline" |
| `ERR_QUOTA_EXCEEDED` | amber banner + remaining in current window + next-window roll time |
| `ERR_QUOTE_EXPIRED` | silent refetch once (caller-imperceptible); two consecutive expiries → red toast |

Never show the platform's internal "reason description" (avoid leaking risk rules); use only the high-level copy above.

### 5.3 Quote-consent binding

- A `quote_id` may only be used once.
- A given call accepts only one `quote_id` (prevents max-bumping by quote swap).
- The caller token claims must embed `quote_id`; mismatch → `ERR_QUOTE_NOT_FOUND`.

### 5.4 Cross-surface price consistency

The price the caller sees must be identical in three places:

- Try-Call drawer quote line
- Approvals card price chip
- Calls detail outcome's "actual debit" line

Any change to the wording in one place forces synchronous changes in the other two. This is a hard review gate.

---

## 6. Recharge entry and the "no fiat withdrawal" disclosure

### 6.1 Recharge entry location

- ops-console **does not** host the full recharge UI (that is platform back-office territory).
- ops-console renders a "Recharge" CTA in balance-exhaustion scenarios → links out to brand-site `/billing/recharge` (path TBD by the brand-site RFC).
- caller-skill MCP tool, when the quote returns `ERR_PREPAID_BALANCE_INSUFFICIENT`, returns a prompt to the Agent: "Balance insufficient; please direct the user to <recharge_url>" — never lets the Agent attempt to "recharge" itself.

### 6.2 Mandated "no fiat withdrawal" disclosure

Per platform RFC §10.4:

- The recharge page + Pricing page + caller-skill first-time consent flow **must** include one line: "This system uses Call Credit points; **non-fiat, non-withdrawable**."
- That line is non-collapsible, non-dismissable, never default-hidden — it is platform compliance, not a UX nicety.
- Recharge confirmation toasts / receipt emails must echo a condensed version of the same line.

### 6.3 Forbidden vocabulary

These words are forbidden across all caller touchpoints:

- "wallet", "account balance", "withdraw"
- "USD", "CNY", any ISO 4217 currency code
- "charge to credit card", "bind a payment method" — caller-side never surfaces payment plumbing

Replacements:

- wallet → "points"
- balance → "Call Credit balance"
- withdraw → don't say it; say "points are not redeemable for fiat"

### 6.4 Recharge mechanics opacity

Callers do not perceive how the platform converts fiat into points (credit card / cross-border / crypto / monthly invoice). All payment plumbing lives in the platform back office; this RFC does not specify it.

---

## 7. Refund toasts and the ledger view

### 7.1 Caller-side rendering of the five refund classes

| Protocol event | Console toast | caller-skill CLI line | Agent prompt |
| :--- | :--- | :--- | :--- |
| `refunded_unverified` | "Signature / schema verification failed; full refund issued." | `Refunded: 50 PTS · reason=unverified` | "The previous call's result failed verification; the platform has auto-refunded." |
| `refunded_timeout` | "Call timed out; full refund issued." | `Refunded: 50 PTS · reason=timeout` | "The previous call timed out without a result; the platform has auto-refunded." |
| `refunded_failed` | "Call failed (non-retryable); full refund issued." | `Refunded: 50 PTS · reason=failed` | "The previous call failed with a non-retryable error; the platform has auto-refunded." |
| `refunded_hotline_frozen` | "This hotline has been frozen; full refund issued." | `Refunded: 50 PTS · reason=hotline_frozen` | "The target hotline has been frozen; the platform has auto-refunded." |
| `refunded_content_rejected` | "Content review failed; full refund issued." | `Refunded: 50 PTS · reason=content_rejected` | "The previous call's result failed content review; the platform has auto-refunded." |

No toast says "please contact support" — these five are machine paths and do not need human ops intervention.

### 7.2 When NOT to fire a toast

- Holds (`billing_held`) — no toast. Reason: every call would fire one; the caller already saw the cap at quote consent.
- Debits (`billing_capped` or under cap) — render the "Charged N points" line in the call's outcome view only; no toast. Reason: the debit is expected, not a surprise.
- Responder credit (`responder.request.credited`) — render a small "+N points" bubble in Dashboard's Earned section; do not interrupt the current page.

### 7.3 Where the ledger lives

- All caller / responder ledger data renders inside **Dashboard** as a "last 30 days credit flow" component — never opens a new page.
- The ledger component aggregates: `caller.request.billing_capped`, `refunded_*`, `responder.request.credited`, `pending_credit_released`, `pending_credit_revoked`.
- A row click jumps to the corresponding Calls or Approvals detail.
- No "Export CSV" — ops-console anti-pattern: don't add export without a real ask.

### 7.4 Where billing events go

- Platform webhook → caller-skill receives → fans out to the console (toast / Dashboard ledger) and Agent prompt (when relevant).
- caller-skill must verify the webhook signature; failure → dead-letter, not console-rendered.

---

## 8. Out of scope

Acknowledged but not refined here:

- Final copy (e.g. "remaining N PTS" vs alternative wording).
- Concrete UI visuals (icon / colour token / radius).
- Recharge UI flow (brand-site / platform back office).
- "Field-extension SDK compatibility matrix for caller-skill tool signatures" — caller-skill impl RFC.
- "Refund toast i18n" — this RFC fixes structure and touchpoints; copy i18n is a landing PR concern.
- "Quote pass-through across chained Agent calls" — chain billing direction is not yet set in protocol; this repo will not speculate.
- A real-time metering panel.
- Pricing-page typography / layout (brand-site).

---

## 9. Roadmap

The caller side ships in lockstep with platform's P-1..P-4:

| Platform stage | Caller-side delivery |
| :--- | :--- |
| P-1 (accounts + balance) | Dashboard ledger MVP (only `caller.request.billing_held` initially) + "switch to local mode" toggle |
| P-2 (preflight + 5 refund classes) | TryCallDrawer wires to preflight + Approvals card price chip + full five-class refund toast set |
| P-3 (trust_tier + content review) | trust_tier chip in three places + disclaimer line + greyed-out frozen hotlines |
| P-4 (dispute + take rate + webhook) | dispute submission entry (ops-console detail + caller-skill CLI) + complete webhook receiver |

Each stage requires:

- The upstream platform impl-RFC has frozen field names / thresholds.
- caller-skill SDK and ops-console land in the same PR.
- `/help` chapters 4 / 5 / 7 update in the same PR after the real ops-console pages change.

---

## Appendix A: UI surface drafts (not frozen)

### A.1 Try-Call drawer quote line

```
[drawer body]
  ...input fields...
  ────────────────────────
  At most 50 PTS · trusted hotline · fixed_price
  ⚠ Possible high-risk output: executable payload   ← only medium/high
  ────────────────────────
  [Cancel]                       [Send call]
```

### A.2 Approvals card price chip

In addition to the existing RiskBadge + StatusBadge, add one chip:

```
[ShieldCheck] Foxlab Text Classifier · foxlab.text.classifier.v1
medium-risk · pending · 50 PTS · max
```

### A.3 Approvals ExecutionBlock charged line

```
[CheckCircle] Succeeded
  Handled by responder_foxlab
  human_summary
  ...returned fields...
  Charged 50 PTS · 12s ago · 1842 ms
```

### A.4 caller-skill CLI quote prompt

```
$ delexec call foxlab.text.classifier.v1 --input "..."
Quote: max 50 PTS, fixed_price (trusted hotline)
Continue? [y/N]: y
... result ...
Charged: 50 PTS
```

### A.5 caller-skill MCP tool signature extension (draft)

```json
{
  "tool": "call_hotline",
  "description": "Invoke a remote hotline by id with the given input.",
  "input_schema": { ... },
  "pricing_summary": {
    "max_charge_cents": 50,
    "currency": "PTS",
    "pricing_model": "fixed_price",
    "trust_tier": "trusted"
  },
  "disclaimer": {
    "risk_level": "info",
    "summary": null
  }
}
```

### A.6 Five-class refund toast copy (draft)

See §7.1 table.

---

## Appendix B: References

- Protocol direction: `repos/protocol/docs/planned/design/billing-and-quota.md`
- Platform surface: `repos/platform/docs/planned/design/billing-design-rfc.md`
- ops-console content contract: `repos/brand-site/docs/console-content-spec.md`
- caller-skill MCP adapter: `repos/client/docs/planned/design/caller-skill-mcp-adapter.md`
- caller-skill host adapters: `repos/client/docs/planned/design/caller-skill-host-adapters.md`
- caller remote hotline skills: `repos/client/docs/planned/design/caller-remote-hotline-skills.md`
