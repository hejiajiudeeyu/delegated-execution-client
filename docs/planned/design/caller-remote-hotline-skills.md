# Caller 注册与 Remote Hotline Skills 接入说明

状态：Implemented baseline  
更新时间：2026-03-13

本文档回答两个问题：

1. Caller 如何注册并获得调用 Remote Hotline 的权限。
2. Caller 侧如何把协议链路封装成 Agent 可一句话调用的 `remote hotline skill`。

本文档面向 Caller 侧宿主实现，不面向 Responder 侧运行时。
本文描述的是 Caller Controller / skill adapter 的较底层接入面，不是终端用户通过统一 `ops` 客户端使用系统的主路径。

## 1. 目标结论

Caller 不应让宿主 Agent 直接学习 `register -> catalog -> prepare -> dispatch -> sync-events -> pull-result` 这整套协议步骤。

正确分层应是：

1. `Platform API` 负责 Caller 注册、目录、token、delivery-meta、事件。
2. `Caller Controller` 负责本地请求状态、超时、验签、结果接收。
3. `Caller Skill Adapter` 负责把上述多步协议封装成一个 Agent 可直接调用的 skill。

对 Agent 来说，最理想的体验应是：

- 用户一句话提出需求。
- 宿主 Agent 调用一个 `remote-hotline` skill。
- skill adapter 内部完成 Caller Controller 编排。
- Agent 只拿到结构化结果或结构化错误，不暴露 token、ACK、投递地址等协议细节。

## 2. Caller 注册

### 2.1 最小注册步骤

1. 调用 `POST /v1/users/register`
2. 保存返回的：
   - `user_id`
   - `api_key`
   - `role_scopes`（默认应包含 `caller`）
3. 在 Caller 侧保存该 API key，后续用于：
   - 拉目录
   - 申请 task token
   - 获取 delivery-meta
   - 拉取 ACK events
   - 上报 Caller metrics

### 2.2 当前仓库中的真实接入点

当前参考实现里，Caller 最稳妥的接入方式不是让宿主 Agent 直接打 Platform API，而是：

1. 启动 [apps/caller-controller/src/server.js](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/apps/caller-controller/src/server.js)
2. 在调用 Caller Controller 时通过 `x-platform-api-key` 传入 Caller 的平台 API key
3. 由 Caller Controller 代为完成与 Platform 的控制面交互

Caller Controller 当前已经暴露的关键接口见 [packages/caller-controller-core/src/index.js](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/packages/caller-controller-core/src/index.js)：

- `GET /controller/hotlines`
- `POST /controller/requests`
- `POST /controller/requests/{request_id}/prepare`
- `POST /controller/requests/{request_id}/contract-draft`
- `POST /controller/requests/{request_id}/dispatch`
- `POST /controller/requests/{request_id}/sync-events`
- `POST /controller/inbox/pull`
- `GET /controller/requests/{request_id}`

## 3. 推荐的 Caller Skill Adapter 分层

Caller 侧面向 Agent 的接入层，推荐拆成一个独立的 `skill adapter`，不要把 Agent 直接绑到 Caller Controller 的多步 HTTP 接口上。

推荐分层如下：

```text
User sentence
  -> Host Agent
  -> Caller Skill Adapter
  -> Caller Controller
  -> Platform API
  -> Remote Hotline Runtime
  -> Caller Controller
  -> Caller Skill Adapter
  -> Host Agent
```

原因很直接：

- 宿主 Agent 不适合负责 `request_id`、超时、ACK 轮询、验签。
- 这些都是确定性控制逻辑，应由代码执行，而不是交给模型反复规划。
- Skill Adapter 可以把协议能力压缩成“一个 skill 调用 + 一个结构化结果”。

## 4. 推荐的一句话接入模型

### 4.1 面向 Agent 的 skill 语义

对宿主 Agent 暴露时，推荐只暴露一个通用 skill：

- `remote-hotline`

其核心输入建议为：

```json
{
  "hotlineId": "foxlab.text.classifier.v1",
  "taskType": "classification",
  "input": {
    "text": "Customer asks for refund after duplicate charge."
  },
  "constraints": {
    "softTimeoutS": 90,
    "hardTimeoutS": 300
  }
}
```

其输出建议为：

```json
{
  "requestId": "req_xxx",
  "status": "SUCCEEDED",
  "result": {
    "summary": "Task completed"
  },
  "resultPackage": {},
  "responder": {
    "responderId": "responder_foxlab",
    "hotlineId": "foxlab.text.classifier.v1"
  }
}
```

如果失败，则返回结构化错误：

```json
{
  "requestId": "req_xxx",
  "status": "FAILED",
  "error": {
    "code": "AUTH_TOKEN_EXPIRED",
    "message": "Task token expired"
  }
}
```

### 4.2 宿主 Agent 的一句话使用方式

宿主 Agent 不需要知道 Caller Controller 的中间步骤。对用户侧应允许这种一句话使用方式：

- “调用 `foxlab.text.classifier.v1`，把这段文本做分类，返回 JSON。”
- “用 `owlworks.data.extractor.v1` 从这段文档里抽取字段。”
- “把这条工单交给远程分类 skill 处理，只保留结构化结果。”

### 4.3 Skill Adapter 内部应做的事

Skill Adapter 收到一次 `invoke` 后，内部应按固定代码路径完成：

1. 根据 `hotlineId` 读取或刷新 catalog
2. 创建 `request_id`
3. 调用 Caller Controller 创建 request
4. 调用 `prepare`
5. 可选生成 `contract-draft`
6. 调用 `dispatch`
7. 轮询或等待：
   - `sync-events`
   - `caller inbox pull`
   - `GET /controller/requests/{request_id}`
8. 直到进入终态：
   - `SUCCEEDED`
   - `FAILED`
   - `UNVERIFIED`
   - `TIMED_OUT`
9. 将终态映射成 skill 返回值

注意：

- `Responder Pull Inbox` 只属于当前 `L0 local transport` 联调路径，不属于 Caller Skill Adapter 的公开语义。
- 在真实远程部署里，Responder 应自行运行并消费自身 inbox；Caller 不应操心 Responder 的 pull 步骤。

## 5. Skill Adapter 的最小接口

当前仓库已经内置首版 Caller Skill Adapter：

- [apps/caller-skill-adapter/src/server.js](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/apps/caller-skill-adapter/src/server.js)

当前实现仍保持最小化：

- 只暴露一个 skill：`remote-hotline`
- `invoke` 第一版要求显式传 `hotlineId`
- 内部复用 Caller Controller 现有 catalog / remote-request / request lookup 能力

### 5.1 `GET /skills/remote-hotline/catalog`

用途：

- 给宿主 Agent 或管理 UI 展示可用的 remote hotline 列表

返回建议：

```json
{
  "items": [
    {
      "hotlineId": "foxlab.text.classifier.v1",
      "responderId": "responder_foxlab",
      "taskTypes": ["classification"],
      "status": "active"
    }
  ]
}
```

### 5.2 `POST /skills/remote-hotline/invoke`

用途：

- 一次性执行 Caller 编排并返回终态结果

请求体建议：

```json
{
  "hotlineId": "foxlab.text.classifier.v1",
  "taskType": "classification",
  "input": {
    "text": "Customer asks for refund after duplicate charge."
  },
  "constraints": {
    "softTimeoutS": 90,
    "hardTimeoutS": 300
  }
}
```

### 5.3 `GET /skills/remote-hotline/requests/{requestId}`

用途：

- 面向长任务或需要异步拉取结果的宿主

返回建议：

- `status`
- `result`
- `error`
- `timeline`
- `resultPackage`

## 6. 设计边界

### 6.1 不要让 Agent 自己做协议编排

不要把以下职责直接交给宿主 Agent：

- 生成和复用 `request_id`
- 判断何时 `prepare`
- 判断何时 `sync-events`
- ACK deadline 和 hard timeout 决策
- 结果签名校验
- schema 校验
- 结果终态归类

这些都应由 Caller Controller 或 Caller Skill Adapter 的确定性代码负责。

### 6.2 不要把 Responder 语义暴露给普通 Caller 用户

Caller 用户需要知道的是：

- 我能调用哪些 remote skills
- 每个 skill 的输入是什么
- 返回结果是什么

Caller 用户通常不需要直接感知：

- responder API key
- delivery address
- token introspect
- ACK event 轮询细节

### 6.3 不要把一个 remote hotline 直接等同为一个宿主“内部 tool”

Remote hotline 是跨信任边界的协议调用，不是宿主本地函数。对宿主 Agent 来说，它更像：

- 一个需要远程授权、远程投递、远程验签的 external skill

因此 skill adapter 需要保留：

- `requestId`
- `responderId`
- `hotlineId`
- `resultPackage`

这些审计与验收信息。

## 7. 对 OpenClaw 的适配原则

OpenClaw 适配的详细说明见 [OpenClaw 适配指南](openclaw-adapter.md)。

这里先冻结三个结论：

1. OpenClaw 不应直接学习 Caller Controller 的多步 HTTP 调用。
2. OpenClaw 最适合接一个 Caller 侧的 `remote-hotline skill adapter`。
3. OpenClaw 里推荐先暴露一个通用 skill：`remote-hotline`，而不是一上来为每个 hotline 暴露一堆分散 skill 名称。
