# Caller Skill MCP Adapter 设计

> 英文版：caller-skill-mcp-adapter.md
> 中文文档为准。

状态：Draft  
更新时间：2026-04-02

本文档定义如何把 `caller-skill` 通过 MCP adapter 暴露给支持 MCP 的 agent 宿主。

主要目标宿主：

- Codex
- Cursor
- Claude Code（在 MCP 可用的环境里）

本文档不重定义 caller-side hotline 业务逻辑，只定义如何把现有 caller-skill 真相层映射成 MCP tools。

## 1. 目标

MCP adapter 应允许 MCP-capable agent 使用 `caller-skill`，但不必理解 caller-controller 的 HTTP 路由。

它应做到：

1. 消费 caller-skill HTTP 真相层
2. 暴露稳定 MCP tools
3. 保持渐进式披露
4. 保持 polling 在 adapter / 真相层

它不应做到：

- 重复 hotline 业务逻辑
- 重复 request 编排逻辑
- 重写 schema 校验规则

## 2. 架构位置

MCP adapter 位于：

- `caller-skill-adapter` 真相层
- 和支持 MCP 的宿主（如 Codex、Cursor）之间

层次关系：

1. `caller-skill-adapter` 提供 HTTP 真相层 + manifest
2. `caller-skill-mcp-adapter` 把它翻译成 MCP tools
3. 宿主注册并调用这些 MCP tools

## 3. 为什么先做 MCP

MCP 应该优先做，因为一套 MCP adapter 很可能能覆盖：

- Codex
- Cursor
- Claude Code（在 MCP-capable 环境里）

这是覆盖面最高、重复最少的第一步。

## 4. 真相来源

MCP adapter 必须把下面这些入口当成真相层：

- `GET /skills/caller/manifest`
- `POST /skills/caller/search-hotlines-brief`
- `POST /skills/caller/search-hotlines-detailed`
- `GET /skills/caller/hotlines/:hotlineId`
- `POST /skills/caller/prepare-request`
- `POST /skills/caller/send-request`
- `GET /skills/caller/requests/:requestId/report`

除非做健康检查或调试，不应绕过这些入口去直接调 caller-controller 原始路由。

## 5. Tool 映射

MCP adapter 应把每个 caller-skill 动作映射成一个 MCP tool。

Canonical tool names：

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

## 5.1 `caller_skill.search_hotlines_brief`

映射到：

- `POST /skills/caller/search-hotlines-brief`

用途：

- 做第一层粗搜索，缩小 hotline 候选范围

## 5.2 `caller_skill.search_hotlines_detailed`

映射到：

- `POST /skills/caller/search-hotlines-detailed`

用途：

- 对少量候选做更详细比较

## 5.3 `caller_skill.read_hotline`

映射到：

- `GET /skills/caller/hotlines/:hotlineId`

用途：

- 正式读取选中 hotline 的 contract 和模板

## 5.4 `caller_skill.prepare_request`

映射到：

- `POST /skills/caller/prepare-request`

用途：

- 对候选输入做校验和规范化

说明：

- `agent_session_id` 最好由 MCP host adapter 注入
- 如果宿主没有稳定 session id，adapter 可自行合成

## 5.5 `caller_skill.send_request`

映射到：

- `POST /skills/caller/send-request`

用途：

- 发送 prepared request，并默认等待终态

默认行为：

- `wait=true`

原因：

- local mode 调用通常应直接返回终态
- polling 应继续留在 adapter 层，不交给模型

## 5.6 `caller_skill.report_response`

映射到：

- `GET /skills/caller/requests/:requestId/report`

用途：

- 读取并归一 request 状态

主要用于：

- 显式异步路径
- 中断恢复
- 重试场景

## 6. Manifest 翻译规则

MCP adapter 应把 `GET /skills/caller/manifest` 当作自己的注册来源。

翻译规则：

1. 每个 manifest action 映射成一个 MCP tool
2. canonical action name 映射成 MCP tool name
3. action description 映射成 MCP tool description
4. orchestration rules 变成 adapter 元数据或宿主提示

建议映射：

- `manifest.skill.name` -> MCP server metadata
- `manifest.actions[]` -> MCP tool registry
- `manifest.orchestration.execution_phase_order` -> adapter guidance
- `manifest.orchestration.go_back_after_read_to` -> adapter guidance
- `manifest.orchestration.polling_owner` -> tool runtime behavior

## 7. 宿主行为约束

MCP adapter 应向宿主稳定传达这些行为约束：

- 搜索/读取阶段顺序灵活
- 执行阶段顺序严格
- 读完 hotline 不满意时可以回退搜索
- `prepare_request` 是发送前强制步骤
- polling 由 adapter / 真相层负责

这些约束应编码到：

- MCP tool descriptions
- server metadata
- 可选的宿主 prompt 提示

## 8. 错误映射

MCP adapter 应尽量保留 caller-skill 的结构化错误，并在宿主允许的情况下原样映射给 MCP tool 调用方。

例如：

- `HOTLINE_NOT_FOUND`
- `HOTLINE_DRAFT_NOT_FOUND`
- `PREPARED_REQUEST_NOT_FOUND`
- `PREPARED_REQUEST_NOT_READY`
- `PREPARED_REQUEST_EXPIRED`

除非宿主强制要求，不应把这些错误压成模糊字符串。

## 9. Session Identity

某些 caller-skill 动作需要稳定 session id，尤其是：

- `prepare_request`

MCP adapter 应支持稳定的 session id 策略：

1. 优先使用宿主提供的 session id
2. 否则生成一个本地稳定 session id
3. 在当前 host conversation/session 内保持稳定

这可用于：

- 旧 prepared request 失效
- 未来 review/audit 挂点

## 10. 长任务与恢复

虽然默认 `wait=true`，MCP adapter 仍应保留长任务恢复路径。

建议：

- 默认 `send_request(wait=true)`
- 明确需要时允许 `wait=false`
- 通过 `report_response` 恢复或续查

这样既能保持短任务体验，又不把 polling 暴露给模型。

## 11. 实现形态

建议实现为：

- 一个独立的 caller-skill MCP server
- MCP server 内部通过 HTTP 调 caller-skill 真相层

建议未来目录：

- `apps/caller-skill-mcp-adapter/`

这样能保持：

- HTTP 真相层独立
- MCP 映射独立
- host profile 独立

## 12. 第一验收目标

第一个明确验收目标应是 Codex。

Codex 验收通过意味着：

1. Codex 能看到 6 个 MCP tools
2. Codex 能搜索 hotline 候选
3. Codex 能读取 hotline contract
4. Codex 能 prepare request
5. Codex 能 send request
6. Codex 能消费终态结果

Codex 通过后，Cursor 应尽量复用同一 MCP adapter。

## 13. 不在本文档范围内

本文档不包含：

- platform mode 供应商选择
- OpenClaw 的 HTTP profile 细节
- Claude Code 的 CLI wrapper 细节
- `prepare_request` 里的 approval workflow

这些属于后续文档。
