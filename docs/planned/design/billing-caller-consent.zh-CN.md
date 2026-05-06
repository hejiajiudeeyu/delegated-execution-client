# Caller 同意流（Billing Caller Consent）方向定位 RFC

> 英文版：[./billing-caller-consent.md](./billing-caller-consent.md)
> 说明：中文文档为准。

状态：草案（方向定位，不冻结字段名 / 文案 / 视觉细节）
分支：`repos/client`
配套阅读：
- 协议方向：`repos/protocol/docs/planned/design/billing-and-quota.zh-CN.md`
- 平台 surface：`repos/platform/docs/planned/design/billing-design-rfc.zh-CN.md`
- 第四仓集成：billing-rfc bundle（T6-4）

---

## 0. 写在前面

这份 RFC 不解释"为什么要做计费"——那是 protocol RFC 的事；也不解释"平台怎么扣费"——那是 platform RFC 的事。它只回答一件事：

> **caller 这一侧**——具体到 caller-skill (MCP / Codex / Claude Code 等 Agent) / ops-console / 帮助文档 / 通知出口——要呈现什么、要让用户同意什么、什么时候打扰用户、什么时候坚决不打扰用户。

以及一条紧绷的反向边界：

> **caller 不应该被强迫"理解"协议层 / 平台层的内部模型**。caller 看到的所有同意点，必须是在他的语义里能在 5 秒内做决策的——不是看 schema 字段名做决策。

本 RFC **不冻结任何文案、字段名、UI 视觉、键盘快捷键**。具体落地以 ops-console 真实页源码 + caller-skill 实际 prompt 为准。

---

## 1. 范围

### 1.1 caller 这一侧的"计费触点"

caller 端的计费触点天然分布在**多个面**上，本 RFC 把它们看成一个总体设计：

| 触点 | 位置 | 频率 |
| :--- | :--- | :--- |
| Agent 通过 caller-skill (MCP / SDK) 发起调用 | `@delexec/caller-skill` 的 MCP 服务 | 每次调用 |
| ops-console「试拨」抽屉发起调用 | `apps/ops-console/src/pages/caller/CatalogPage.tsx` | 每次手动试拨 |
| ops-console 审批中心审批一条调用 | `apps/ops-console/src/pages/caller/CallerApprovalsPage.tsx` | 每条 pending |
| caller-skill 命令行直接调 | `apps/cli/src/commands/calls.js` 等 | 每次调用 |
| 余额 / 退款 / 计费事件通知 | console toast / Agent surface | 实扣 / 退款 |

这 5 类触点必须共用同一份"同意契约"，否则会出现"Agent 看到一种文案，console 看到另一种文案"的撕裂——caller 直接失去对系统的信任。

### 1.2 与 protocol / platform RFC 的关系

| 上游硬要求 | client 这一侧的落地 |
| :--- | :--- |
| 协议 §4.2 hotline 自报 + 上限封顶 | UI 必须把 `max_charge_cents` 翻译成"最多扣 N 点"； **不**展示 hotline 内部 token / unit 细节 |
| 协议 §5.1 预扣 + 单次结算 | 实扣发生时显式 toast；预扣不打扰（避免每调一次弹一次）|
| 协议 §5.2 自动退款 5 类 | 5 种退款 toast 各有 hand-off CTA；**不**让 caller 误以为需要主动申诉 |
| 协议 §6 trust_tier | UI 显示 `trusted` / `verified` / `untrusted` / `frozen`；不暴露内部分数 |
| 协议 §6.5 内容审查 | 审查拒绝 → 红 toast + 退款已自动；**不**渲染被 mask 的内容 |
| 平台 §4.1 preflight | 试拨抽屉 / Agent prompt 必须在调用前就拿到 quote 并展示 max；**不**允许"先调后告诉" |
| 平台 §10.4 不接入法币 | 充值入口 / Pricing 文案明确"非法币、无提现"；**不**用『balance』『余额』『钱包』等会被联想为法币的术语 |

任何 caller-side 设计违反这张表都不接受。

### 1.3 非目标

- 不冻结具体文案（"还需扣 N 点"还是"将扣 N PTS"——文案最终在落地 PR 决定）。
- 不冻结具体视觉（颜色 / icon / radius 等延续 ops-console 现有 token）。
- 不替 platform 决策抽佣比例 / 退款延时 / 充值入口的支付方式。
- 不接入实时计量面板（caller 不需要看实时点数消耗曲线，这是面向运维的能力）。
- 不再造一个"通用 toast 通知中心"——console 已有 sonner，沿用即可。

---

## 2. 同意点的硬要求

### 2.1 一条调用必须经过的两个同意闸门

caller 同意 = 闸门 1（quote 同意） + 闸门 2（实扣告知），不是别的。

- **闸门 1：调用前的 quote 同意**——必须 in-line 出现在调用界面上，不能藏到 settings 里默认勾选。`max_charge_cents` 必须翻译成自然语言数字（"最多扣 50 PTS"），不能仅以 schema 字段呈现。
- **闸门 2：实扣发生的告知**——必须 in-line 出现在调用结果展示里，不能用 banner 替代。"实扣金额"必须是数字，且不与 max 混在同一处（避免视觉合并）。

闸门 1 之后、闸门 2 之前，不再额外打扰 caller（不弹"调用进行中…"扣费提示）。

### 2.2 同意必须显式且可拒绝

- 默认勾选 = 视为未同意（v0.1 协议骨架已规定）。
- "记住这次同意" 仅限**同 hotline + 同 max_charge_cents 阈值**——不允许"勾选一次，所有 hotline 全自动同意"（那是审批模式 `allow_all` 的语义，不是计费同意的语义）。
- 拒绝同意 = 调用流程立即终止，不写 ledger，不发请求。

### 2.3 同意的颗粒度

caller 看到的同意决策只有 4 类：

1. **价格上界**（max_charge_cents）—— 强制每次都看到。
2. **disclaimer**（针对 medium / high 风险 hotline）—— 强制 medium / high 看到。
3. **是否记住这次决策**（针对该 hotline + max_charge）—— 可选，default off。
4. **充值不足时是否切到本地模式继续工作**—— 不在调用同意里，而在 prefer 设置里。

任何不属于上述 4 类的"同意"都属于平台 / 协议层职责，**不**在 caller 端要 caller 勾。

---

## 3. 4 个 caller 触点的同意流

### 3.1 caller-skill (MCP / SDK)

Agent（Codex / Claude Code 等）通过 caller-skill 的 MCP 工具调 hotline 时：

- caller-skill 必须在向 Agent 返回工具签名时**主动包含** `pricing_summary` 字段——`{"max_charge_cents": 50, "currency": "PTS", "pricing_model": "fixed_price"}`。
- 工具返回的 prompt 模板必须明确："调用此 hotline 将扣 N 点，由 caller 同意 / 由 caller 名单自动同意"。
- 高风险（medium / high）的 hotline，工具签名里必须带 `disclaimer.summary` 字段——单行 ≤ 80 字。
- caller-skill **不**自行帮 Agent 决定是否同意——它把 quote 透传给 Agent，由 Agent 决定（手动模式下转给 caller console 走人审）。

### 3.2 ops-console「试拨」抽屉

人工试拨时（CatalogPage TryCallDrawer）：

- 抽屉打开瞬间 fire-and-forget 调 platform `/v1/preflight` 拿 quote。
- 在「发送调用」按钮上方，紧贴按钮，渲染**1 行**：
  - "最多扣 N PTS"（粗体）
  - "（trusted hotline）" / "（untrusted · 落账延迟 7 天）"等附加修饰。
- 高风险 hotline → 紧挨着上述行，渲染 1 行红色 disclaimer summary。
- caller 不点「发送调用」 = 视为未同意 = 不发请求。
- 抽屉里**不**展示 hotline 的内部价格分解（`base + 0.5 ¢/sec` 等）。这种细节属于 brand-site Pricing 页 / `/help#pricing-models` 的范畴。

### 3.3 ops-console 审批中心

Agent 发的调用进入 caller 审批中心（CallerApprovalsPage）：

- 每张 pending 卡的 header 区已有 RiskBadge / StatusBadge；新增一个"价格 chip"——`50 PTS · max`。
- "批准"按钮文案保持不变，但点击批准 = **同意当次扣费上限**。
- 已批准的卡（status=approved）在 ExecutionBlock footer 多展示一行"实扣 N 点"——这是闸门 2。
- 加白名单 popover（M6）保持不变，但加上一行"信任此 hotline · 后续按 quote 自动放行"——明示加白名单 ≠ 自动放过任意金额，仍然受 caller global preference 中的 `max_charge_cents_per_call_default` 限制（具体字段名实现层定）。

### 3.4 caller-skill 命令行（CLI）

CLI 用户群体偏开发者，但同意闸门不能因此简化掉：

- `delexec call <hotline_id> --input ...` 默认在调用前**显示一行 quote**："Quote: max 50 PTS, fixed_price" + 等待回车 / 输入 `y`。
- 提供 `--yes` 短路同意，但首次使用时打印警告："--yes 表示你接受所有未来调用的最高 N 点扣费——确认请重跑加 `--yes-confirmed`"（双确认 pattern）。
- 实扣时打印一行 "Charged: N PTS"（闸门 2）。
- 失败 / 退款时打印一行 "Refunded: N PTS · reason=<code>"（5 类退款共用模板）。

---

## 4. trust_tier 在 UI 上的呈现规则

### 4.1 三处展示位

| 位置 | 形态 | 何时显示 |
| :--- | :--- | :--- |
| Catalog 卡 + 详情 | 小 chip · 紧挨 hotline display name | 始终 |
| 「试拨」抽屉 quote 行 | 文字附注 | 始终 |
| Approvals 卡 header | RiskBadge 旁 chip | 始终 |

### 4.2 文案与颜色（方向，不冻结具体值）

- `trusted`：默认色（slate / 灰）—— "trusted hotline"。
- `verified`：绿色 —— "verified hotline"。
- `untrusted`：黄色 —— "untrusted · 收益落账延迟"。
- `frozen`：红色 —— "已冻结，不可调用"（同时隐藏「试拨」按钮）。

### 4.3 不展示的东西

- 不展示 trust_tier 的"内部分数"（如 0.85）—— 协议层不暴露。
- 不展示"trust_tier 上次变化时间"——caller 不需要看 hotline 的运营状态变化日志。
- 不展示 "trust_tier 升级到下一档还差多少调用次数"——这是 hotline 自己的事，caller 越界。

### 4.4 frozen 时的行为

任何 hotline 进入 frozen 时：

- Catalog 卡变灰，「试拨」按钮 disable + tooltip 解释。
- Approvals 中已 pending 但还没批的，自动变 expired（协议层硬规定）。
- 已批准但还没拿到 result 的，protocol §5.2 走 `caller.request.refunded_hotline_frozen`，UI 显示红色 toast：「该 hotline 已被冻结，已自动全额退款」。
- frozen 是事故路径，不需要"如何申诉"链接——属于平台运营事件，应该在 brand-site 公告页发声明。

---

## 5. preflight quote 在 console 上的呈现

### 5.1 何时拉

- 只在 caller "明确即将调用"那一刻拉——TryCallDrawer 打开 / CLI `delexec call` 启动 / Agent 通过 caller-skill 拿工具签名时。
- **不**在 Catalog 列表浏览时为每张卡预拉 quote（成本太高，且 quote 5 分钟过期没意义）。
- 拉到的 quote_id 在内存里持有；过期则提示重拉，不静默续约。

### 5.2 quote 失败的兜底

| 平台返回 | UI 行为 |
| :--- | :--- |
| `ERR_BILLING_INTERNAL` | 红 toast + "重试" 按钮；不阻塞用户继续浏览其他 hotline |
| `ERR_PREPAID_BALANCE_INSUFFICIENT` | 黄色 banner + 「去充值」CTA + 「切到本地模式继续工作」次链 |
| `ERR_TRUST_TIER_LIMIT_EXCEEDED` | 黄色 banner + "该 hotline 单次调用上限低于你的 max_charge 设置 — 请下调 max_charge 或选其他 hotline" |
| `ERR_QUOTA_EXCEEDED` | 黄色 banner + 当前窗口剩余 + 下一窗口翻页时刻 |
| `ERR_QUOTE_EXPIRED` | 静默重拉一次（caller 无感）；连续两次还过期 → 红 toast |

不展示 quote 失败的"内部 reason 描述"（避免泄露平台风控规则）；只用上面的高层文案。

### 5.3 quote 与同意的绑定

- 同一 quote_id 只能用于一次调用。
- 同一调用只接受同一 quote_id（防止改 max 后偷换 quote）。
- caller token claims 里嵌入 quote_id；mismatch → `ERR_QUOTE_NOT_FOUND`。

### 5.4 价格的"多语言一致性"

caller 看到的价格表达必须三处一致：

- "试拨"抽屉 quote 行
- Approvals 卡价格 chip
- Calls 详情 outcome 段实扣行

任何一处文案变了 → 必须三处同步改。这是落地 review 的硬卡点。

---

## 6. 充值入口与"无法币提现"披露

### 6.1 充值入口位置

- ops-console **不**做充值流程的完整 UI（属于 platform 后台职责）。
- ops-console 在余额耗尽场景下显示一个「去充值」CTA → 跳到 brand-site `/billing/recharge`（路径由 brand-site RFC 决定）。
- caller-skill MCP 工具在 quote `ERR_PREPAID_BALANCE_INSUFFICIENT` 时返回给 Agent 一段 prompt："余额不足，请引导用户访问 <recharge_url>"——而不是 Agent 自己尝试『充值』。

### 6.2 "无法币提现" 的强制披露

按 platform RFC §10.4：

- 充值入口页 + Pricing 页 + caller-skill 第一次同意流时，**必须**包含 1 行说明："本系统使用『Call Credit』点数，**不与法币兑换、不可提现**"。
- 这条说明不可以折叠 / 不可以 dismiss / 不可以默认隐藏——它是平台合规的强制披露。
- 充值后 toast / 邮件回单中也必须再次包含这条说明的精简版。

### 6.3 不允许出现的术语

下面这些词在 caller 触点全面禁止：

- "钱包"、"账户余额"、"提现"
- "USD"、"CNY"、ISO 4217 货币代码
- "充值到信用卡"、"绑定支付方式"——caller-side 不出现支付环节细节

替换术语：

- 钱包 → "点数"
- 余额 → "点数余额" / "Call Credit balance"（en）
- 提现 → 不用，直接说"点数不可兑回法币"

### 6.4 充值方式的"无感"

caller 端不感知 platform 是怎么把法币转成点数的（信用卡 / 跨境支付 / 加密货币 / 企业月结发票）——所有支付细节都在 platform 后台，client RFC 不规定。

---

## 7. 退款 toast 与对账面

### 7.1 5 类退款的 caller 端表达

| 协议事件 | console toast | caller-skill CLI 行 | Agent prompt |
| :--- | :--- | :--- | :--- |
| `refunded_unverified` | "签名 / schema 验证失败，已自动全额退款" | `Refunded: 50 PTS · reason=unverified` | "上次调用结果验签失败，平台已自动退款。" |
| `refunded_timeout` | "调用超时，已自动全额退款" | `Refunded: 50 PTS · reason=timeout` | "上次调用超时未返回结果，平台已自动退款。" |
| `refunded_failed` | "调用失败（不可重试），已自动全额退款" | `Refunded: 50 PTS · reason=failed` | "上次调用失败且非临时错误，平台已自动退款。" |
| `refunded_hotline_frozen` | "该 hotline 已被冻结，已自动全额退款" | `Refunded: 50 PTS · reason=hotline_frozen` | "目标 hotline 已被平台冻结，平台已自动退款。" |
| `refunded_content_rejected` | "内容审查未通过，已自动全额退款" | `Refunded: 50 PTS · reason=content_rejected` | "上次调用结果未通过平台内容审查，平台已自动退款。" |

所有 toast 文案不允许出现"请联系客服"——这 5 类是机器化路径，不需要客服介入。

### 7.2 不弹 toast 的场景

- 预扣（`billing_held`）—— 不弹 toast。理由：每次调用都弹，疲劳；caller 在 quote 同意时已知道。
- 实扣（`billing_capped` 命中或未命中 max）—— 仅在 console 详情页里以"实扣 N 点"行展示，不弹 toast。理由：实扣是预期行为，不是 surprise。
- responder 入账（`responder.request.credited`）—— 在 console 中以"+N 点"小气泡展示在 Dashboard 的 Earned 区，不打扰当前页。

### 7.3 对账面在哪

- caller / responder 角色的对账数据全部在 **Dashboard** 上以"近 30 天点数流水"组件展示——不另开新页。
- 对账组件聚合：`caller.request.billing_capped` / `refunded_*` / `responder.request.credited` / `pending_credit_released` / `pending_credit_revoked`。
- 单条流水点击 → 跳到对应 Calls 详情或 Approvals 详情。
- 不引入"导出 CSV"（v0.1 ops-console 反模式：没有需求凭空加导出）。

### 7.4 计费事件的去向

- platform webhook 出事件 → caller-skill 接收 → 同时分发到 console（toast / Dashboard 流水）+ Agent prompt（必要时）。
- caller-skill 必须验证 webhook signature；验证失败 → 进 dead-letter，不影响 console 渲染。

---

## 8. 不在本 RFC 范围

承认存在但本 RFC 不细化：

- 具体文案（"还需扣 N PTS" 还是别的措辞）。
- 具体 UI 视觉（icon / 颜色 token / radius）。
- 充值流程的 UI（属 brand-site / platform 后台）。
- "如何把现有的 caller-skill 工具签名扩字段"的 SDK 兼容矩阵——属于 caller-skill 实现层 RFC。
- "退款 toast 国际化"——本 RFC 只规定结构与触点，文案 i18n 是落地 PR 的事。
- "Agent 多 hotline chained 调用时的 quote 透传"——chained billing 协议方向尚未定，不在本仓投机。
- 实时计量面板。
- Pricing 页的视觉与排版（属 brand-site）。

---

## 9. 路线图

caller 端按 protocol P-1..P-4 milestone 逐步上：

| platform 阶段 | client 这一侧要做的 |
| :--- | :--- |
| P-1（账户 + balance） | Dashboard 流水组件最小版（先只展示 `caller.request.billing_held`） + "切到本地模式"切换 |
| P-2（preflight + 5 类退款） | TryCallDrawer 接 preflight + Approvals 卡价格 chip + 5 类退款 toast 完整化 |
| P-3（trust_tier + 内容审查） | trust_tier chip 三处展示 + disclaimer 行渲染 + frozen hotline 灰显 |
| P-4（dispute + take rate + webhook） | dispute 提交入口（ops-console 详情页 + caller-skill CLI）+ webhook 接收完整化 |

每阶段必须满足：

- 上游 platform RFC 实现层 RFC 已 freeze 字段名 / 阈值。
- caller-skill SDK 与 ops-console 同 PR 改完。
- /help 第 4-5-7 章对应章节同步更新（在 ops-console 真实页改完后必须同 PR 改 /help）。

---

## 附录 A：UI surface 草案（不冻结）

### A.1 试拨抽屉 quote 行

```
[抽屉 body]
  ...input fields...
  ────────────────────────
  最多扣 50 PTS （trusted hotline · fixed_price）
  ⚠ 高风险输出可能：执行型 payload   ← 仅 medium/high
  ────────────────────────
  [取消]                       [发送调用]
```

### A.2 Approvals 卡价格 chip

Header 区现有 RiskBadge + StatusBadge 之外，新增一个 chip：

```
[ShieldCheck] Foxlab Text Classifier · foxlab.text.classifier.v1
中风险 · 待审批 · 50 PTS · max
```

### A.3 Approvals ExecutionBlock 实扣行

```
[CheckCircle] 执行成功
  由 responder_foxlab 处理
  human_summary
  返回结果 ...
  实扣 50 PTS · 完成时间 12s 前 · 耗时 1842 ms
```

### A.4 caller-skill CLI quote 提示

```
$ delexec call foxlab.text.classifier.v1 --input "..."
Quote: max 50 PTS, fixed_price (trusted hotline)
Continue? [y/N]: y
... result ...
Charged: 50 PTS
```

### A.5 caller-skill MCP 工具签名扩字段（草案）

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

### A.6 5 类退款 toast 文案（草案）

见 §7.1 表。

---

## 附录 B：引用

- 协议方向：`repos/protocol/docs/planned/design/billing-and-quota.zh-CN.md`
- 平台 surface：`repos/platform/docs/planned/design/billing-design-rfc.zh-CN.md`
- ops-console 内容契约：`repos/brand-site/docs/console-content-spec.md`
- caller-skill MCP adapter：`repos/client/docs/planned/design/caller-skill-mcp-adapter.zh-CN.md`
- caller-skill host adapters：`repos/client/docs/planned/design/caller-skill-host-adapters.zh-CN.md`
- caller remote hotline skills：`repos/client/docs/planned/design/caller-remote-hotline-skills.zh-CN.md`
