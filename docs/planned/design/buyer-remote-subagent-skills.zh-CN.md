# Buyer 注册与 Remote Subagent Skills 接入说明

> 英文版：buyer-remote-subagent-skills.md
> 说明：中文文档为准。

状态：Implemented baseline  
更新时间：2026-03-13

本文档回答两个问题：

1. Buyer 如何注册并获得调用 Remote Subagent 的权限。
2. Buyer 侧如何把协议链路封装成 Agent 可一句话调用的 `remote subagent skill`。

本文档面向 Buyer 侧宿主实现，不面向 Seller 侧运行时。  
本文描述的是 Buyer Controller / skill adapter 的较底层接入面，不是终端用户通过统一 `ops` 客户端使用系统的主路径。

## 1. 目标结论

Buyer 不应让宿主 Agent 直接学习 `register -> catalog -> prepare -> dispatch -> sync-events -> pull-result` 这整套协议步骤。

正确分层应是：

1. `Platform API` 负责 Buyer 注册、目录、token、delivery-meta、事件。
2. `Buyer Controller` 负责本地请求状态、超时、验签、结果接收。
3. `Buyer Skill Adapter` 负责把上述多步协议封装成一个 Agent 可直接调用的 skill。

对 Agent 来说，最理想的体验应是：

- 用户一句话提出需求。
- 宿主 Agent 调用一个 `remote-subagent` skill。
- skill adapter 内部完成 Buyer Controller 编排。
- Agent 只拿到结构化结果或结构化错误，不暴露 token、ACK、投递地址等协议细节。

## 2. Buyer 注册

### 2.1 最小注册步骤

1. 调用 `POST /v1/users/register`
2. 保存返回的：
   - `user_id`
   - `api_key`
   - `role_scopes`（默认应包含 `buyer`）
3. 在 Buyer 侧保存该 API key，后续用于：
   - 拉目录
   - 申请 task token
   - 获取 delivery-meta
   - 拉取 ACK events
   - 上报 Buyer metrics

### 2.2 当前仓库中的真实接入点

当前参考实现里，Buyer 最稳妥的接入方式不是让宿主 Agent 直接打 Platform API，而是：

1. 启动 [apps/buyer-controller/src/server.js](/Users/hejiajiudeeyu/Documents/Projects/remote-subagent-protocol/apps/buyer-controller/src/server.js)
2. 在调用 Buyer Controller 时通过 `x-platform-api-key` 传入 Buyer 的平台 API key
3. 由 Buyer Controller 代为完成与 Platform 的控制面交互

Buyer Controller 当前已经暴露的关键接口见 [packages/buyer-controller-core/src/index.js](/Users/hejiajiudeeyu/Documents/Projects/remote-subagent-protocol/packages/buyer-controller-core/src/index.js)。

## 3. 推荐的 Buyer Skill Adapter 分层

Buyer 侧面向 Agent 的接入层，推荐拆成一个独立的 `skill adapter`，不要把 Agent 直接绑到 Buyer Controller 的多步 HTTP 接口上。

```text
User sentence
  -> Host Agent
  -> Buyer Skill Adapter
  -> Buyer Controller
  -> Platform API
  -> Remote Subagent Runtime
  -> Buyer Controller
  -> Buyer Skill Adapter
  -> Host Agent
```

## 4. 推荐的一句话接入模型

对宿主 Agent 暴露时，推荐只暴露一个通用 skill：`remote-subagent`。  
输入输出与错误结构建议保持原文中的 JSON 形态，以便统一编排与审计。

## 5. Skill Adapter 的最小接口

当前仓库已内置首版 Buyer Skill Adapter：  
[apps/buyer-skill-adapter/src/server.js](/Users/hejiajiudeeyu/Documents/Projects/remote-subagent-protocol/apps/buyer-skill-adapter/src/server.js)

建议接口：

- `GET /skills/remote-subagent/catalog`
- `POST /skills/remote-subagent/invoke`
- `GET /skills/remote-subagent/requests/{requestId}`

## 6. 设计边界

- 不要让 Agent 自行编排协议步骤
- 不要把 Seller 语义暴露给普通 Buyer 用户
- 不要把 remote subagent 等同为宿主内部 tool

## 7. 对 OpenClaw 的适配原则

详细说明见 [OpenClaw 适配指南](openclaw-adapter.md)。
