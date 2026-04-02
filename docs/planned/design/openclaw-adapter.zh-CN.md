# OpenClaw 适配指南

> 英文版：openclaw-adapter.md
> 中文文档为准。

状态：Draft  
更新时间：2026-04-02

本文档说明如何把 `client` 中 Caller 侧的 hotline 能力适配成 OpenClaw 可直接使用的 skill。

本文档已对齐新的 local mode `caller-skill` 设计，不再把旧的 `remote-hotline` 三接口模型当作主合同。

## 1. 目标

OpenClaw 不应学习底层 Caller 请求协议。

正确目标应是：

1. OpenClaw 只看到一个稳定的 caller-side skill 面
2. 桥接层负责请求编排
3. OpenClaw 只拿到整理好的结果，而不是协议噪音

## 2. 为什么需要桥接层

OpenClaw 的 skill 接入天然更适合高层能力接口，而不适合直接调用 caller-controller 的多步流程。

如果直接暴露 caller-controller，模型就不得不自己处理：

- request 生命周期顺序
- request id 管理
- 重试与等待策略
- 协议化结果处理

这些都应留在代码里，而不是交给模型。

## 3. 推荐适配形态

### 3.1 一个稳定 skill

优先推荐一个稳定 skill：

- `caller-skill`

不建议暴露大量 responder 绑定的 skill 名称。

### 3.2 渐进式披露

桥接层应暴露 6 个渐进式动作：

1. `search_hotlines_brief`
2. `search_hotlines_detailed`
3. `read_hotline`
4. `prepare_request`
5. `send_request`
6. `report_response`

搜索/读取阶段顺序灵活。

执行阶段顺序强制：

1. `read_hotline`
2. `prepare_request`
3. `send_request`
4. `report_response`

如果 OpenClaw 读完 hotline 后觉得不适合，应允许退回：

- `search_hotlines_brief`
- `search_hotlines_detailed`

## 4. OpenClaw 配置建议

OpenClaw 的具体配置要看宿主环境，但桥接层的概念入口应指向：

- base URL: `http://127.0.0.1:8091/skills/caller`

推荐入口：

- `GET /skills/caller/manifest`
- `POST /skills/caller/search-hotlines-brief`
- `POST /skills/caller/search-hotlines-detailed`
- `GET /skills/caller/hotlines/:hotlineId`
- `POST /skills/caller/prepare-request`
- `POST /skills/caller/send-request`
- `GET /skills/caller/requests/:requestId/report`

桥接层不应暴露 responder secret 或协议内部细节。

## 5. 动作语义

### 5.1 `search_hotlines_brief`

用于第一层粗搜索，做大空间缩圈。

返回：

- `hotline_id`
- `display_name`
- `short_description`
- `task_types`
- `match_reason`
- `score`

### 5.2 `search_hotlines_detailed`

用于小范围候选比较。

返回 richer metadata：

- `description`
- `input_summary`
- `output_summary`
- `draft_ready`
- `local_only`
- `review_status`

### 5.3 `read_hotline`

用于选定 hotline 后正式读取 contract。

返回：

- input schema
- output schema
- 字段 description
- 本地 draft 信息

### 5.4 `prepare_request`

用于每次发送前的准备阶段。

桥接层应：

- 读取 hotline 模板
- 将候选输入与 schema 比对
- 做字段校验和规范化
- 持久化短期 prepared request

这也是未来挂接：

- review
- approval
- risk check

的正确位置。

### 5.5 `send_request`

只接受 `prepared_request_id`。

桥接层应：

- 复用 prepared 的 normalized input
- 通过 caller-side request 流程发送
- 默认内部轮询到终态

### 5.6 `report_response`

用于把终态结果整理成模型可继续使用的结构。

返回：

- `status`
- `result`
- `result_package`
- `error`
- 可选 `human_summary`

## 6. 轮询策略

默认由 adapter 轮询。

对于普通 local mode 调用，不应让 OpenClaw 自己轮询。

原因：

- polling 是确定性编排逻辑
- 不应占用模型上下文
- 桥接层可以直接返回终态

## 7. 与当前仓库的映射

OpenClaw-friendly 动作面应建立在：

- [apps/caller-skill-adapter/src/server.js](/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/apps/caller-skill-adapter/src/server.js)
- [packages/caller-controller-core/src/index.js](/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/packages/caller-controller-core/src/index.js)

桥接层应消费 `caller-skill` 动作面，而不是直接暴露 caller-controller 原始路由。

## 8. Prompt 建议

给 OpenClaw 的提示词应明确：

- 当任务适合由 hotline 执行时，优先使用 `caller-skill`
- 不要手工拼 caller-controller 多步 HTTP
- 返回结构化结果，而不是协议细节
- 如果读完 hotline 发现不适合，可以回退到搜索

## 9. 当前边界

当前仓库已经有 local mode 的 caller-skill 动作面，但还没有内置专门的 OpenClaw 注册包或 OpenClaw 专用 bridge app。

也就是说：

- agent-facing contract 已经存在
- 真正的 OpenClaw 注册仍是后续步骤
