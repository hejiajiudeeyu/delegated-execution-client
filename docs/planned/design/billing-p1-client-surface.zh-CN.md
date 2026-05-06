# P-1 客户端实施层 RFC：ops-console 余额展示与 ops CLI `tenant` 组

> 英文版：[./billing-p1-client-surface.md](./billing-p1-client-surface.md)
> 说明：中文文档为准。

状态：草案（实施层，会冻结字段名 / hook 契约 / CLI 命令名 / 错误码处理）
分支：`repos/client`
配套阅读：

- 协议方向：`repos/protocol/docs/planned/design/billing-and-quota.zh-CN.md`
- 平台方向：`repos/platform/docs/planned/design/billing-design-rfc.zh-CN.md`
- 平台 P-1 实施层：`repos/platform/docs/planned/design/billing-p1-tenant-balance-impl.zh-CN.md`（以下简称『platform P-1 RFC』）
- 客户端方向（caller 同意）：`repos/client/docs/planned/design/billing-caller-consent.zh-CN.md`（以下简称『caller-consent 方向 RFC』）

---

## 0. 写在前面

这份 RFC 在 protocol/platform/client 的 P-1 三联中是**第三块**：

- 协议方向 RFC 已经定了"必须存在合并余额、quota 窗口、5 类 auto-refund"。
- platform P-1 RFC 已经在平台仓冻结了 4 张表 / 3 个 endpoint / 6 个错误码 / 4 条监控指标 / 1 个不可变性 daemon。
- 本 RFC 在 client 仓冻结**与 platform P-1 endpoint 对接的客户端表面**——即 ops-console 与 `@delexec/ops` CLI 这两层在 P-1 阶段能上的能力。

它的范围**比 caller-consent 方向 RFC 窄得多**：

| | caller-consent 方向 RFC | 本 RFC（client P-1 实施层）|
| :--- | :--- | :--- |
| 触点覆盖 | caller-skill / ops-console / CLI / 通知 4 类 | 只覆盖 ops-console + ops CLI 两类 |
| 同意闸门 | 闸门 1（quote 同意）+ 闸门 2（实扣告知） | **都不上**——P-1 阶段无 quote、无 hold/debit |
| 退款 toast | 5 类 | **不上**——P-1 阶段没有退款 |
| trust_tier 渲染 | 必须渲染 | **不渲染**——P-1 阶段 platform 还没 trust_tier daemon |
| 充值入口 | 文案禁止 fiat 联想 | 沿用现有 brand-site /pricing 文案；本 RFC 不动 |

P-1 阶段客户端的核心定位：

> **客户端在 P-1 阶段是『余额观察者』，不是『扣费参与者』**。caller-skill / Agent / CLI 在 P-1 阶段照常发起调用、照常拿结果——余额只是个**只读窗口**。真正的扣费链路（hold / debit / refund / quote）由 P-2 引入。

本 RFC 一旦合入：

- ops-console 上的余额展示位 + hook 名 + 字段映射就是冻结的。
- ops CLI `tenant balance` / `tenant ledger` 两个新命令的命令名 + 输出 schema 就是冻结的。
- 后续 P-2 / P-3 / P-4 阶段可以**追加**新触点（例：调用前 quote 抽屉、退款 toast），但**不允许**改本 RFC 冻结的命令名 / hook 名 / 字段名。

不在本 RFC 范围（仍属 P-2 及之后阶段）：

- preflight quote 抽屉 / Agent prompt 同意闸门（P-2）
- 5 类 auto-refund toast（P-2）
- trust_tier 徽标 / 风险声明 disclaimer 渲染（P-3）
- caller-skill MCP 协议字段层面的 billing claims（P-2）
- 充值入口实现（独立 RFC）

---

## 1. 范围与与 v0.1 客户端的关系

### 1.1 P-1 客户端要交付的东西

物理产物：

- ops-console 新两个 hook：`useTenantBalance()`、`useTenantLedger()`（§4）
- ops-console 新一个余额卡组件 `<TenantBalanceCard>`，挂在 DashboardPage 顶部（§3）
- ops-console 新一页 `/balance`（路径冻结 `/balance`，不冠 caller / responder 前缀），渲染余额 + ledger 列表（§3）
- ops CLI 新一个命令组 `tenant`，下挂两条命令：`tenant balance`、`tenant ledger`（§5）
- 6 个 platform P-1 错误码的客户端处理策略（§7）

### 1.2 与 v0.1 客户端的兼容立场

本 RFC 全部产物都是**新增**——不动任何现有 hook / 页面 / CLI 命令的对外行为：

- caller-skill MCP server 的 tool schema **不变**（quote / billing claims 是 P-2 的事）。
- caller / responder 的 v0.1 token 流不变。
- 现有 DashboardPage 不删任何卡片；本 RFC 只**追加**一个 TenantBalanceCard。
- 现有 ops CLI 的所有命令（`ui start`, `auth register`, `responder *`）不变；本 RFC 只**追加** `tenant` 组。

旧 v0.1 客户端在 P-1 platform 上线后照常工作——它们看不到余额，也不会被余额限制（platform §5.4 默认 hard_block_on_exceed=false，与无余额体验等价）。

### 1.3 P-1 客户端的可上线判定

满足下面 4 条 P-1 客户端才能宣告完成：

1. 两个 hook + TenantBalanceCard + `/balance` 页通过单元测试 + 端到端契约测试。
2. ops CLI 两条新命令在本机模式（platform 无连接）下走 graceful 路径，不抛 ENOENT / 不打印 stack trace（§5.4）。
3. platform P-1 RFC §1.3 的 5 条 release gate 已绿；本 RFC 不允许在 platform P-1 未 GA 之前落地客户端。
4. 文档：`HelpPage.tsx` §"账户与余额" 章节同步更新（不要新增章节，沿用现有结构）。

---

## 2. 物件总览

P-1 客户端引入的物件：

```
ops-console (apps/ops-console)
   └── src/hooks/
   │       ├── useTenantBalance.ts        ← 单租户余额 + 三档 quota 窗口
   │       └── useTenantLedger.ts         ← keyset 分页拉 ledger
   │
   ├── src/components/billing/
   │       ├── TenantBalanceCard.tsx      ← Dashboard 顶部余额卡
   │       └── LedgerList.tsx             ← 余额变动列表
   │
   └── src/pages/general/
           └── BalancePage.tsx            ← /balance 路由的整页

ops CLI (apps/ops)
   └── src/cli.js                         ← 追加 'tenant' 组分支
```

每个物件的契约由对应小节冻结。

---

## 3. ops-console 余额展示位

### 3.1 路由与导航位

- 路由路径冻结为 `/balance`——不冠 `/caller/` 也不冠 `/responder/` 前缀，理由：余额本身**不分 caller / responder**（这是 platform P-1 RFC §3.1 的硬要求物理化）。
- 顶部导航增加一个 nav item，label 文案在落地 PR 决定（caller-consent 方向 RFC §1.2 已禁止 fiat 联想词，例如 label 不允许写"钱包" "余额（USD）" 等）；图标用现有 token。
- DashboardPage 顶部追加一个 `<TenantBalanceCard>`（默认折叠形态：1 行余额 + 1 行 quota 进度），用户点击展开看 quota 详情；不在 DashboardPage 上展示 ledger。

### 3.2 BalancePage（`/balance`）的结构

```
┌──────────────────────────────────────────────────────────────┐
│  TenantBalanceCard（展开形态）                               │
│  - credit_balance_cents / pending_credit_cents               │
│  - 三档 quota window 进度条（daily / monthly / total）       │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  LedgerList                                                  │
│  - 默认按 recorded_at desc 列出最近 50 条                    │
│  - 顶部有 kind filter（chip 多选）+ since（date picker）     │
│  - 列表底部有「加载更多」按钮（keyset 分页）                 │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  EmptyState（zero-ledger）                                   │
│  - 文案体感："还没有余额变动" + 跳 brand-site /pricing 充值  │
│  - 不写"去充值"——按 caller-consent 方向 RFC §1.2 禁 fiat 联想│
└──────────────────────────────────────────────────────────────┘
```

### 3.3 TenantBalanceCard 文案与字段映射

冻结文案 anchor（具体落地文案在 PR 决定，但 anchor 名字冻结）：

| anchor | 字段映射 | 体感 |
| :--- | :--- | :--- |
| `balance.spendable.label` | `credit_balance_cents / 100` | 主余额（可花的） |
| `balance.pending.label` | `pending_credit_cents / 100` | 副余额（暂未释放） |
| `balance.window.daily.label` | `windows[kind=daily]` | 日度窗口 |
| `balance.window.monthly.label` | `windows[kind=monthly]` | 月度窗口 |
| `balance.window.total.label` | `windows[kind=total]` | 总窗口 |

**禁止**直接展示这些 platform 内部字段名：

- ❌ 不渲染 `version`（CAS 版本号是平台内部）
- ❌ 不渲染 `rate_limit_per_second`（速率限制是平台内部，与 caller 体感无关）
- ❌ 不渲染 `currency` 字段值（P-1 阶段唯一允许值是 `PTS`，写死显示『点』即可，不让 UI 跟着 schema 飘）

### 3.4 P-1 阶段的『默默不动』之处

这些行为在 P-1 阶段**显式不实现**（P-2 才上）：

- 调用前的 quote 抽屉（caller-consent 方向 RFC §3.2 闸门 1）
- 实扣 toast / hold release toast（同上 闸门 2）
- 5 类 auto-refund toast
- caller-skill MCP tool schema 改动
- "余额不足时切到本地模式"的 prefer 切换

要在 P-1 上手动测试『余额会不会变』，唯一路径是 ops admin 经过 `POST /v1/tenants/{tenant_id}/recharge` endpoint（即 platform P-1 RFC §4.3）。

---

## 4. Hook 契约

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

冻结点：

- hook 名是 `useTenantBalance`，**不**叫 `useBalance` / `useWallet` / `useCallCredit`——hook 名就是平台 endpoint 的对应物。
- 字段名是 `creditBalanceCents` / `pendingCreditCents` / `windows[].kind` 等——与 platform P-1 RFC §4.1 response 字段一一对应（snake → camel）。
- `currency` 在 P-1 阶段固定字面量 `"PTS"`；P-? 法币阶段才扩 union。
- `creditMode` 在 P-1 阶段固定字面量 `"prepaid"`；预留给 future `"postpaid_invoice"`。
- 返回值是判别联合类型，调用方必须先收窄 `state`——避免裸读 `data?.creditBalanceCents` 导致渲染时 flicker。
- hook 内部用 `usePoll` 每 60s 拉一次（沿用现有 `apps/ops-console/src/hooks/usePoll.ts`）；不允许 hook 自己再开一个轮询循环。

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

冻结点：

- 默认 `pageSize = 50`，等于 platform P-1 RFC §4.2 的服务端默认；也是 endpoint cap 200 的 1/4，留余量给客户端实验性增大。
- `kinds` filter 走客户端转 query string 的 `?kind=` 重复参数，与 platform endpoint 一致。
- `loadMore()` 在 in-flight 时返回 noop（不允许双击触发两次 fetch + 双倍渲染）。
- hook 内部不缓存跨 mount 的 cursor；每次 mount 重头拉。如果用户分页到第 3 页后切到别的页面再回来，回到第 1 页——这是 P-1 阶段的有意识简化（避免引入持久化状态）。

### 4.3 `ClientError` 的字段约束

```ts
type ClientError = {
  code:
    | "ERR_TENANT_NOT_FOUND"
    | "ERR_BILLING_CURRENCY_UNSUPPORTED"   // P-1 客户端不会主动发起，只在防御性场景出现
    | "ERR_QUOTA_EXCEEDED"                  // P-1 hard_block 默认 off，可见但概率极低
    | "ERR_BILLING_INTERNAL"
    | "ERR_NETWORK"                         // 客户端补充：fetch 抛 / 超时 / 5xx 重试穷尽
    | "ERR_UNAUTHORIZED";                   // 客户端补充：401 / 403
  message: string;                          // 面向用户的本地化文案
  retryable: boolean;
  raw?: unknown;                            // 原始 platform error 体，仅 dev 模式渲染
};
```

冻结点：

- `code` union 只能含上述 6 个值；P-2 引入新错误码（例 `ERR_QUOTE_EXPIRED`）时**追加**到 union，不允许改名既有值。
- `retryable` 由 hook 根据 platform error.retryable + 网络错误类型推断，调用方不需自己判。

---

## 5. ops CLI `tenant` 命令组

### 5.1 命令名冻结

```
delexec tenant balance  [--json]
delexec tenant ledger   [--kind=<kind>]... [--since=<iso>] [--limit=<n>] [--json]
```

冻结点：

- 组名 `tenant`——不叫 `wallet` / `account` / `credit`，与 platform endpoint namespace 对齐。
- 子命令名 `balance` / `ledger`——与 hook 名对齐。
- 全局 flag：`--json` 切机器可读输出（ndjson 行格式）；省略时走 TTY 友好的表格输出。
- `--kind` 可重复，与 endpoint query 的 `?kind=` 同义；命令行短形式 `-k` 暂不开放（避免占用单字母命名空间）。

### 5.2 TTY 友好输出（默认）

```
$ delexec tenant balance
余额： 50000 PTS（pending 800 PTS）
日度窗口：    25000 / 100000 PTS  (caller 25000, responder earn 4000)
月度窗口：   350000 / 2000000 PTS  (caller 350000, responder earn 60000)
总窗口：    1850000 / 无上限       (caller 1850000, responder earn 320000)
```

```
$ delexec tenant ledger --limit=3
2026-05-06 10:31  debit         caller_spend     -50 PTS  req_01HFA1ZZZ
2026-05-06 09:55  recharge      system        +10000 PTS  rch_01HF...
2026-05-04 14:12  admin_adj.    system          -200 PTS  -
```

冻结点：

- 单位永远是 `PTS`（不显示 `cents`，TTY 输出不打 `cents` 单位）。
- 数字精度：cents → 整数 PTS（除以 100，向下取整）；尾数损失会在 `--json` 模式下保留。
- 时间显示用本地时区 + `YYYY-MM-DD HH:mm` 格式；`--json` 输出原 ISO 8601 UTC。
- TTY 输出列对齐用 ASCII 空格，**不**用 box-drawing 字符（避免在简陋终端里乱码）。

### 5.3 `--json` 输出（机器可读）

```
$ delexec tenant balance --json
{"ok":true,"command":"tenant balance","data":{...same shape as endpoint response...}}
```

```
$ delexec tenant ledger --json --limit=3
{"ok":true,"command":"tenant ledger","data":{"items":[...],"hasMore":true,"nextCursor":"..."}}
```

冻结点：

- 顶层结构 `{ ok, command, data }` 是现有 ops CLI 的统一形态——本 RFC 不另起。
- `data` 直接透传 platform endpoint 的 response（除把字段名 snake → camel，与 §4 hook 一致）。
- 错误情形输出 `{ ok: false, command, error: { code, message, retryable } }`，且 exit code 非零。

### 5.4 platform 不可达时的 graceful 路径

P-1 客户端可能在两种环境下被调起：

- 已对接 platform：CLI 走 platform endpoint。
- 纯本地模式（无 platform）：caller-skill 仍可用本地 hotline runtime；但 `tenant balance` / `tenant ledger` 无意义。

P-1 阶段冻结纯本地模式下两条命令的行为：

- exit code = 2（区别于成功 0、其他 error 1）。
- TTY 输出："本机模式：未连接 platform，所以无 tenant 余额。先按 brand-site 文档接入 platform，或忽略本提示。"
- `--json` 输出：`{"ok":false,"command":"tenant balance","error":{"code":"ERR_LOCAL_MODE","message":"...","retryable":false}}`。
- 不抛 stack trace，不打 ENOENT，不污染 stderr。

`ERR_LOCAL_MODE` 是 P-1 阶段客户端内部错误码，**不**进 §4.3 `ClientError.code` 的 union（那个 union 只装会从 platform 来的值）。

---

## 6. caller-skill MCP 在 P-1 阶段的表现

### 6.1 显式不动

caller-skill 的 MCP tool schema 在 P-1 阶段**完全不变**。具体含义：

- `delegated_call` tool 的输入参数不增加 `quoteId` / `maxChargeCents` / `consentToken`（这些是 P-2）。
- `delegated_call` 的返回 envelope 不增加 `debit` / `refundClass`（这些是 P-2）。
- 没有任何新的 MCP tool 在 P-1 阶段引入（`tenant_balance` 之类**不**作为 MCP tool 暴露给 Agent，Agent 用 ops CLI / ops-console 即可）。

### 6.2 P-1 阶段调用『感觉不到余额』的设计

在 P-1 platform 默认 `hard_block_on_exceed=false`（platform P-1 RFC §5.4）的前提下，caller-skill 视角看到的 P-1 阶段是：

- 调用照常发出、照常拿结果。
- 没有 hold / debit ledger 行（P-2 才有）。
- 没有 quota block（默认 off）。
- 没有 toast / Agent prompt 同意闸门。

caller-skill 文档需要追加一段 P-1 阶段的 disclaimer：

> "P-1 阶段不扣点。Agent 在调用 hotline 时不会消耗你的 Call Credit；正式扣费链路在 P-2 阶段引入。"

文案 anchor 在 caller-skill `apps/caller-skill/README.md` 顶部，本 RFC 不冻结具体字句。

### 6.3 与 caller-consent 方向 RFC 的不冲突

caller-consent 方向 RFC §2.1 规定了"两个同意闸门"，本 RFC 不上闸门——这与方向 RFC **不冲突**，因为方向 RFC §0 写的是"具体落地以 ops-console 真实页源码 + caller-skill 实际 prompt 为准"，且方向 RFC 没有规定『P-1 阶段必须有闸门』。

P-1 阶段没有 quote、就没有可同意的对象——同意闸门是 P-2 阶段引入 quote 后的必要条件，不是充分条件。

---

## 7. 错误码客户端处理

| Platform 错误码 | 客户端 hook 行为 | 客户端 CLI 行为 | 用户文案体感 |
| :--- | :--- | :--- | :--- |
| `ERR_TENANT_NOT_FOUND` | hook → error state | exit 1 + 红色提示 | "找不到该 tenant；请检查 platform 注册状态" |
| `ERR_BILLING_CURRENCY_UNSUPPORTED` | hook → error state（防御）| exit 1 | dev 模式才渲染（生产基本不会触发） |
| `ERR_QUOTA_EXCEEDED` | hook → error state + retry-after | exit 1 + 提示 retry | "今日 quota 已达上限，明日 UTC 00:00 之后重试" |
| `ERR_BILLING_INTERNAL` | hook → error state，自动重试一次 | exit 1 | "platform 内部异常，已重试一次"，不暴露 stack |
| 401 / 403 | hook → `ERR_UNAUTHORIZED` | exit 3 | "登录态失效或权限不足" |
| 网络/超时 | hook → `ERR_NETWORK`，自动重试 3 次（指数回退） | exit 4 | "网络异常，已重试 3 次" |

冻结点：

- exit code map（0 / 1 / 2 / 3 / 4）就是上表，与 ops CLI 现有 exit code 约定对齐。
- 自动重试只针对 `retryable=true` 的错误；其他错误一次失败即退出。
- 客户端**不**把 `ERR_QUOTA_EXCEEDED` 包装成『去充值！』的 CTA——P-1 阶段充值由运营完成，不是用户操作（caller-consent 方向 RFC §1.2 反 fiat 联想）。

---

## 8. 测试与发布矩阵

### 8.1 单元测试覆盖（P-1 客户端 release gate 第 1 条）

最少要覆盖：

- `useTenantBalance` 三态（loading / ready / error）渲染快照
- `useTenantLedger` 的 `loadMore` 幂等：in-flight 时连点两次只发一次 fetch
- `useTenantLedger` 的 kinds filter 拼 query string 正确（含重复参数）
- `<TenantBalanceCard>` 折叠 / 展开切换不丢 props
- `BalancePage` 在 zero-ledger 状态下渲染 EmptyState 而非空白
- ops CLI `tenant balance` / `tenant ledger` 在『platform 200 / 404 / 5xx / 网络断』四种情况下的 stdout / exit code

### 8.2 契约测试（端到端）

- 与 platform staging 的真 endpoint 跑一轮 happy path：先 `POST /v1/tenants/{id}/recharge`、再 `useTenantBalance` 拉到、再 `useTenantLedger` 看到那条 recharge 行。
- 验证 hook 字段映射与 §4.1 / §4.2 完全一致。
- 验证 CLI `--json` 输出与 §5.3 完全一致。

### 8.3 灰度策略

P-1 客户端 GA 路径：

- shadow：ops-console 内部用户先用 7 天，监控 console 错误率不上升。
- public：随平台 P-1 GA 一同放出；nav item 在 P-1 platform 不可用时 graceful 隐藏（§5.4 同款 ERR_LOCAL_MODE）。

### 8.4 回滚路径

- ops-console 拉掉 `/balance` 路由 + nav item + DashboardPage 的 `<TenantBalanceCard>`，旧用户体感 = P-0 阶段。
- ops CLI 隐藏 `tenant` 组（命令仍存在但不在 `--help` 列出）；老脚本仍工作。

---

## 9. 边界条件与已知妥协

### 9.1 `tenant_id` 的来源

- ops-console：从现有 `useAuth` 的 session 里读，**不**让用户在 UI 里手动填 tenant_id。
- ops CLI：从本地 `~/.delexec/credentials.json` 读；缺失时走 §5.4 `ERR_LOCAL_MODE`。

### 9.2 跨 caller / responder 的余额视图

合并余额是 platform P-1 RFC §3.1 的硬要求；客户端**遵守**：

- 同一份 `<TenantBalanceCard>` 同时给 caller 和 responder 看，不分页签。
- LedgerList 默认混合显示 `caller_spend` / `responder_earn` / `system` 三方向；用 `--kind` filter 才能拆。
- DashboardPage 上不展示『caller 视角余额』『responder 视角余额』分窗——那会暗示余额是分开的。

### 9.3 `pending_credit_cents` 在 P-1 阶段的体感

- Platform P-1 RFC 已经为 `pending_credit_cents` 留好 schema 列，但 P-1 阶段**不会**有任何写入路径写入它（pending_credit_release / pending_credit_revoke 是 P-3 阶段 trust_tier daemon 才写）。
- 客户端必须**不假设它一直为 0**——hook 字段已经 typed 为 `number`，UI 在 `pending > 0` 时显式渲染（而非 happy path 假设 0 而炸）。
- 文案 anchor `balance.pending.label` 的具体字句在 P-3 阶段才需要敲定（届时 trust_tier 也会上 UI）；P-1 临时用 "暂未释放点数" 即可。

### 9.4 客户端轮询频率与服务端负载

- `useTenantBalance` 60s 一次；`useTenantLedger` 不主动轮询，仅在 mount + `loadMore()` 时拉。
- `<TenantBalanceCard>` 同一会话只 mount 一次（DashboardPage 顶部）；`/balance` 页 mount 时复用同一 hook 不另起。
- 这与 platform P-1 RFC §4.1 response 中的 `rate_limit_per_second: 2` 远低于上限——保守，给 P-2 引入 quote / debit 的额外读放预算。

### 9.5 离线 / dev 模式

- 客户端 dev 模式（`pnpm run dev` 时 `VITE_OFFLINE=1`）下 hook 走 mock 数据；mock 数据形态必须严格对齐 §4.1 / §4.2 schema。
- mock 数据**不**进 git（仅 dev 临时文件），以防忘删污染 prod 渲染。

---

## 10. 路线图

P-1 客户端阶段内部 milestone（与 platform P-1 M1.x 不一一对应，但需在 platform M1.4 之后开始）：

| milestone | 主题 | 解锁 |
| :--- | :--- | :--- |
| C1.1 | `useTenantBalance` + `<TenantBalanceCard>`（折叠形态） | DashboardPage 顶部能看到余额数字 |
| C1.2 | `/balance` 页 + 展开形态 + LedgerList | 用户能查看 quota 三档 + ledger 列表 |
| C1.3 | ops CLI `tenant` 组 | 脚本化 / Agent 自动化场景能拿到余额 |
| C1.4 | 错误码处理 + graceful local-mode + HelpPage 同步 | 上线 release gate |

每个 milestone 都需要：

- 上一 milestone 已通过 ops-console 内部 dogfood 7 天。
- 单元测试覆盖率符合 §8.1。
- 与 platform staging 的契约测试绿。

---

## 附录 A：与 platform P-1 RFC 字段对照

| Platform P-1 RFC（snake） | 本 RFC（camel） | 对照状态 |
| :--- | :--- | :--- |
| `tenant_id` | `tenantId` | 一致 |
| `credit_balance_cents` | `creditBalanceCents` | 一致 |
| `pending_credit_cents` | `pendingCreditCents` | 一致 |
| `currency` | `currency` | 一致；P-1 唯一字面量 `"PTS"` |
| `windows[].window_kind` | `windows[].kind` | 字段名缩短（去 `window_` 前缀），union 字面量不变 |
| `windows[].window_started_at` | `windows[].windowStartedAt` | 一致 |
| `windows[].max_amount_cents` | `windows[].maxAmountCents` | 一致；nullable 一致 |
| `windows[].used_as_caller_cents` | `windows[].usedAsCallerCents` | 一致 |
| `windows[].earned_as_responder_cents` | `windows[].earnedAsResponderCents` | 一致 |
| `windows[].hard_block_on_exceed` | `windows[].hardBlockOnExceed` | 一致 |
| `rate_limit_per_second` | `rateLimitPerSecond` | 一致；UI 不渲染 |
| `credit_mode` | `creditMode` | 一致；P-1 唯一字面量 `"prepaid"` |
| `ledger_kind` enum | `LedgerKind` union | 一致；9 个值字符串完全相同 |
| `ledger_direction` enum | `LedgerDirection` union | 一致；3 个值字符串完全相同 |
| `next_cursor` | （hook 内部消费，不暴露给调用方） | endpoint 字段，hook 不冻结对外 |

---

## 附录 B：与 caller-consent 方向 RFC 的不冲突清单

下列条目本 RFC 显式**不冲突**于 caller-consent 方向 RFC：

- caller-consent §1.1 的 5 类触点 → 本 RFC P-1 阶段只覆盖 ops-console + ops CLI 两类，其余 3 类（caller-skill / Agent surface / 通知出口）在 P-1 阶段保持原状。这是**进度**问题，不是**方向**问题。
- caller-consent §2.1 闸门 1 / 闸门 2 → 本 RFC P-1 阶段都不上，因 P-1 没有 quote / 没有 hold/debit；P-2 阶段引入 quote 时由 P-2 客户端实施 RFC 落地。
- caller-consent §2.3 同意 4 类（max / disclaimer / 记住决策 / 余额不足切本地）→ P-1 阶段一个都不上，理由同上。
- caller-consent §1.2 反 fiat 联想 → 本 RFC §3.1 / §7 多处遵守（不写"钱包"、不让 `ERR_QUOTA_EXCEEDED` 引导『去充值』）。

如果 P-2 阶段引入 quote 时这张表里的任何一行变成『冲突』，必须先发起 caller-consent 方向 RFC 的修订 PR、然后再写 P-2 客户端实施 RFC——绝对不允许 P-2 实施 RFC 单方面违反方向 RFC。

---

## 附录 C：引用

- 协议方向：`repos/protocol/docs/planned/design/billing-and-quota.zh-CN.md`
- 平台方向：`repos/platform/docs/planned/design/billing-design-rfc.zh-CN.md`
- 平台 P-1 实施层：`repos/platform/docs/planned/design/billing-p1-tenant-balance-impl.zh-CN.md`
- 客户端方向：`repos/client/docs/planned/design/billing-caller-consent.zh-CN.md`
- 现有 ops-console hook 基础设施：`repos/client/apps/ops-console/src/hooks/useStatus.ts`、`usePoll.ts`
- 现有 ops CLI 入口：`repos/client/apps/ops/src/cli.js`
