# delegated-execution-client

> 英文版：[README.md](README.md)
> 说明：中文文档为准。

> **属于 [CALL ANYTHING](https://callanything.xyz/)** —— 让任意 AI Agent 调用任意外部能力的开放协议。
> 本仓库是 **终端用户 CLI 与本地运行时**：装一次 `delexec-ops`，既可以作为 **Caller** 把任务委托给远端 Hotline，也可以作为 **Responder** 把本地项目发布成任何 Agent 都能拨通的 Hotline。
>
> 📖 [Docs](https://callanything.xyz/docs/) · [Caller 快速开始](https://callanything.xyz/docs/quick-start-caller/) · [Responder 快速开始](https://callanything.xyz/docs/quick-start-responder/) · [术语表](https://callanything.xyz/glossary/) · [Blog](https://callanything.xyz/blog/) · [Marketplace](https://callanything.xyz/marketplace/)

---

## 关于 CALL ANYTHING

CALL ANYTHING 是一套面向 **AI Agent 委托外部能力（delegated execution）** 的开放协议。模型很小，60 秒能学完：

- **Hotline** —— 把身份、计费、审批、可观测、路由全部固化在协议里的标准化能力契约。一根 Hotline 可以**暴露成** MCP server、OpenAPI 端点或 `SKILL.md` —— 那些只是接入面，Hotline 才是产品形态。
- **Caller / Responder** —— 每一通调用都有两端。Caller 通常是跑在 Cursor / Claude Code / 自定义 runtime 里的 AI Agent（或 Agent 团队）；Responder 通常是 **超级个体（OPC, One-Person Company）** —— 把私域专长包装成 7×24 在线、按次结算、Agent 可直接调用的服务实体的个人。
- **本客户端**就是 Caller / Responder 两端都跑的那个进程。`delexec-ops` 是守护进程（supervisor），负责挂载本地 Hotline、转发调用、记录 ops 事件，并暴露一个本地 Web 控制台 —— Caller 侧管审批策略 / 调用日志 / 计费，Responder 侧管 Hotline 上下架 / 版本灰度 / 收入。

如果你是 OPC，想把私有知识 / 工作流变成可调用、可结算的 Hotline，**这个 repo 是你的起点**。本地模式跑通后，可以接入 [delegated-execution-platform-selfhost](https://github.com/hejiajiudeeyu/delegated-execution-platform-selfhost) 自托管平台发布 catalog，或直接挂到公开 marketplace [callanything.xyz/marketplace](https://callanything.xyz/marketplace/) 上。

兄弟仓库：

- 📐 **协议真实来源** —— [delegated-execution-protocol](https://github.com/hejiajiudeeyu/delegated-execution-protocol)（发布 `@delexec/contracts`）
- 🚀 **自托管平台与运维控制台** —— [delegated-execution-platform-selfhost](https://github.com/hejiajiudeeyu/delegated-execution-platform-selfhost)
- 🌐 **公开 Marketplace、文档、品牌站** —— [callanything.xyz](https://callanything.xyz/)

---

## 快速开始

### 本地模式

如果你只想在一台机器上验证 `client` 仓本地闭环，不接入 platform 审核或 catalog 发布，请先看：

[本地模式上手指南](docs/current/guides/local-mode-onboarding.zh-CN.md)

如果你希望直接让另一个 agent 代你完成安装，请从[Agent 本地安装剧本](docs/current/guides/agent-local-install-playbook.zh-CN.md)开始。

当前官方本地路径包括：

- `delexec-ops start` 自动拉起 embedded local relay
- `delexec-ops auth register --local --email <email>`
- 本地 responder 启用
- 示例 hotline draft 查看
- 本地自调用到 `SUCCEEDED`

如果你是从源码安装，请优先使用仓库根目录的 npm 入口：

```bash
npm install
npm run ops -- start
```

在全新 clean-room 环境验证本地模式时，优先使用这条路径，不要先用 `pnpm --filter @delexec/ops exec ...`。

机器本地的 hotline 接入配置和 hook 文件应统一放在 `DELEXEC_HOME` 下，不要放进 git 工作区。当前本地运行时使用：

- `ops.config.json`：运行时状态
- `hotline-registration-drafts/`：热线 draft
- `hotline-integrations/`：本机接入配置
- `hotline-hooks/`：可选本机 hook stub

### Platform Bootstrap（后续流程）

platform / 社区发布不是当前仓库的主要产品路径。请先跑通本地模式，再视需要进入这条后续流程。

```bash
npm install -g @delexec/ops
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

Bootstrap 完成后打开本地 Web 控制台：

```bash
delexec-ops ui start --open
```

初始化向导引导你完成本地口令设置与 Caller 身份注册。

![初始化向导](docs/screenshots/setup-wizard.png)

---

## Dashboard

登录后，Dashboard 实时展示所有本地服务进程的运行状态及其与平台的连通性。

![Dashboard](docs/screenshots/dashboard.png)

服务健康度卡片展示以下状态：

- **Caller 进程** — 本地 caller-controller 运行时
- **Responder 进程** — 本地 responder-controller 运行时
- **Relay** — 本地传输中继（如启用）
- **Platform API** — 已连接平台的可达性

---

## Transport 配置

在 Transport 页面无需重启即可切换 **Local**、**Relay HTTP**、**Email** 三种传输通道。

![Transport 配置](docs/screenshots/transport-config.png)

- **Local** — 进程内直接通信，无需网络。适合开发与测试场景。
- **Relay HTTP** — 消息经 HTTP Relay 中转。适合跨机器部署或防火墙场景。
- **Email** — 基于 EmailEngine / Gmail 的异步邮件传输，支持需要人工介入的工作流。

---

## Caller — 发起委托

### Hotline Catalog

浏览并调用平台上发布的 Hotline。

![Hotline Catalog](docs/screenshots/caller-catalog.png)

每张 Hotline 卡片展示 Hotline ID、描述及能力标签，点击**调用**即可发起请求。

### Call 请求

实时追踪所有出站 Call 请求及其状态。下方的手动测试面板支持直接向任意 Hotline ID 发送测试调用。

![Call 请求](docs/screenshots/caller-calls.png)

---

## Responder — 响应委托

### Hotline 管理

将本地项目注册为 Hotline，通过一个开关即可启用或停用。Responder 侧管理哪些 Hotline 处于激活状态，并在 Hotline 进入目录前追踪其审核状态。

![Hotline 管理](docs/screenshots/responder-hotlines.png)

将本地项目挂载为 Hotline：

```bash
delexec-ops attach-project \
  --project-path /absolute/path/to/project \
  --project-name "My Local Project" \
  --project-description "说明这个项目能为远端 Caller 做什么" \
  --hotline-id local.my-project.v1 \
  --cmd "node worker.js"
```

---

## 仓库职责

本仓库负责端用户客户端运行时：

- `@delexec/ops` 产品包及 `delexec-ops` CLI
- Caller 侧本地控制流与 Responder 侧本地运行时管理
- 本地状态、密钥处理、SQLite 客户端存储及本地传输适配器
- 客户端引导、Bootstrap、诊断与排障文档

本仓库不负责协议真实来源定义，也不负责运维侧自托管平台部署。

## 公开产品面

本仓库唯一的端用户安装入口为 `@delexec/ops`。用户应通过 `delexec-ops` 使用客户端，而不是手动组合内部包。

## 内部包

本仓库包含内部实现包（caller/responder 控制器、本地存储、传输适配器）。因 `@delexec/ops` 依赖它们而保持可测试与可发布状态，但它们不是主要产品面。

## 状态

`@delexec/contracts` 已发布到 npm，本仓库可独立运行 CI 与隔离环境包检查。

## 维护说明

本仓库中部分共享包因其他仓库在拆分过渡期间仍依赖它们而单独发布。它们应被视为实现支撑包，而非主要客户端产品面。

参见：`docs/current/guides/release-surface.md`
参见：`docs/current/guides/source-integration-runbook.md`

## 如何在此仓库开发

- 当变更涉及端用户 CLI 流程、本地 caller/responder 行为、本地持久化或客户端传输连接时，从本仓库开始。
- 保持产品边界：普通用户只需要 `@delexec/ops`。
- 保持共享内部包足够稳定以支持测试与打包，但文档与示例以 `delexec-ops` 路径为核心进行优化。

推荐变更流程：

1. 若变更影响协议语义，先更新 `delegated-execution-protocol` 并消费已发布的 `@delexec/contracts`。
2. 在本仓库实现客户端运行时与 CLI 变更。
3. 发布前运行仓库 CI 与包检查。
4. 仅在其他仓库依赖时发布共享支撑包；否则以 `@delexec/ops` 作为面向用户的发布产物。
