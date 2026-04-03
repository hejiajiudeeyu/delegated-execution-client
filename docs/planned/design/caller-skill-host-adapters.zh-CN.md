# Caller Skill 多宿主适配设计

> 英文版：caller-skill-host-adapters.md
> 中文文档为准。

状态：Draft  
更新时间：2026-04-02

本文档定义如何把 `caller-skill` 暴露给多个 agent 宿主，例如 Codex、Claude Code、Cursor、OpenClaw。

本文档不重定义 caller-skill 业务逻辑，只定义多宿主接入时的适配层结构。

## 1. 目标

系统应支持多个 agent 宿主，但不重复 hotline 业务逻辑。

目标宿主包括：

- Codex
- Claude Code
- Cursor
- OpenClaw

目标原则：

1. 一个 caller-side 真相层
2. 一层薄的宿主适配层
3. 一层更薄的宿主配置层

## 2. 基本原则

不要因为产品名不同就做四套桥接。

不要直接做：

- `codex-bridge`
- `cursor-bridge`
- `claude-code-bridge`
- `openclaw-bridge`

四套彼此独立的业务实现。

正确拆法应是三层：

1. caller-skill 真相层
2. host adapter 层
3. host profile 层

## 3. 三层结构

## 3.1 真相层：`caller-skill-adapter`

这是 caller-side hotline skill 的单一业务真相层。

它负责：

- 渐进式披露动作模型
- local mode 的 read/prepare/send/report
- request 编排
- 轮询
- prepared request 持久化

其动作面是：

- `GET /skills/caller/manifest`
- `POST /skills/caller/search-hotlines-brief`
- `POST /skills/caller/search-hotlines-detailed`
- `GET /skills/caller/hotlines/:hotlineId`
- `POST /skills/caller/prepare-request`
- `POST /skills/caller/send-request`
- `GET /skills/caller/requests/:requestId/report`

这一层必须保持宿主中立。

## 3.2 宿主适配层

这一层负责把 caller-skill 真相层翻译成各宿主需要的工具接入协议。

推荐按协议族来分，而不是按产品名来分：

- HTTP skill adapter
- MCP adapter
- CLI adapter

每种 adapter 都应保持很薄，不承载 hotline 业务逻辑。

## 3.3 宿主配置层

这一层只负责具体产品配置。

每个宿主 profile 只应定义：

- 这个宿主怎么注册工具
- base URL 或 MCP server 地址
- 工具命名和描述提示
- 宿主专用 prompt 建议

不能重复实现校验、编排、结果处理。

## 4. Adapter 类型

## 4.1 HTTP skill adapter

适用于天然消费固定 HTTP skill endpoint 的宿主。

典型适配：

- OpenClaw

职责：

- 以稳定 HTTP endpoint 暴露 caller-skill 动作
- 提供 manifest 或等价发现合同
- 保持渐进式披露

不负责：

- caller 业务逻辑
- hotline 选型策略的业务真相

## 4.2 MCP adapter

适用于天然消费 MCP tools 的宿主。

典型适配：

- Codex
- Cursor
- Claude Code（如果该环境可用 MCP）

职责：

- 把 caller-skill 每个动作映射成一个 MCP tool
- 使用 caller-skill manifest 里的动作元数据
- 保持 caller-skill 动作名稳定

推荐工具名：

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

## 4.3 CLI adapter

适用于更擅长本地命令或 wrapper script 的宿主。

典型适配：

- Claude Code 在 MCP 不可用时

职责：

- 通过本地命令包装 caller-skill 动作面
- 但保持相同动作语义

这是兜底型 adapter，不是首选。

## 5. 各宿主建议

## 5.1 Codex

首选传输：

- 通过 `streamable_http` 的 MCP

原因：

- Codex 天然适合 tool / MCP 模式
- caller-skill 的 6 个动作可以很自然映射成 MCP tools

建议：

- 做一个 `caller-skill` MCP adapter
- 真实 Codex 验收时优先使用 `streamable_http`，不要默认走 stdio
- 把 6 个动作注册成 MCP tools

## 5.2 Cursor

首选传输：

- 通过 `streamable_http` 的 MCP

建议：

- 不做 Cursor 专有业务桥
- 复用 Codex 同一套 MCP adapter
- 只补 Cursor 的 host profile
- 默认沿用与 Codex 相同的 `streamable_http` 注册路径

## 5.3 Claude Code

首选传输：

- 能用 MCP 就优先 MCP
- 否则用 CLI adapter

建议：

- 优先尽量复用 Codex / Cursor 的 MCP 路径
- 只有在运行时不适合 MCP 时才退到 CLI wrapper

## 5.4 OpenClaw

首选传输：

- HTTP skill adapter

原因：

- OpenClaw 天然适合固定 `baseUrl` 的 HTTP skill 模型
- 如果 caller-skill HTTP 面已经稳定，就不需要额外再套一层 MCP

建议：

- 直接将 OpenClaw 指向 caller-skill HTTP 合同
- 用 manifest 描述动作集

## 6. 为什么这样更合理

这种拆法避免 4 种重复：

1. hotline 搜索逻辑重复
2. prepare/校验逻辑重复
3. request 编排逻辑重复
4. result 归一逻辑重复

真正应该因宿主而变化的，只是工具注册方式和传输方式。

## 7. Manifest 要求

caller-skill manifest 应作为真相层和宿主适配层之间的交接点。

至少应描述：

1. skill metadata
2. action list
3. orchestration rules
4. host hints

建议 host hints 字段：

- `preferred_transport`
- `default_wait`
- `polling_owner`
- `supports_long_running`
- `input_size_limits`

这些字段应帮助 host adapter 自动决定怎么映射，而不是引入新的业务真相。

## 8. 工具命名规则

跨宿主应保持稳定的动作名。

推荐 canonical names：

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

不要把 responder-specific 或 hotline-specific 名称作为主要 public entrypoint。

## 9. Prompt 规则

不同宿主的 prompt 可以略有差异，但行为约束应一致：

- 先搜索
- 读完再 prepare
- prepare 后才能 send
- 读完 hotline 不满意时可回退搜索
- 轮询由 adapter 负责

prompt 差异应只存在于 host profile，不应进入 caller 业务逻辑。

## 10. Local Mode 与 Platform Mode

本设计先只面向 local mode。

在 local mode 中，宿主适配层只需要解决：

- hotline 能力发现
- contract 读取
- request preparation
- request dispatch
- result report

未来 platform mode 需要把更复杂的选择因素纳入宿主体验，例如：

- responder 质量
- hotline 运营表现
- 成功率
- 延迟
- 专业性
- 审核状态
- SLA / 服务质量

这属于后续扩展，不应阻塞首版多宿主 rollout。

## 11. 建议落地顺序

推荐顺序：

1. 稳定 caller-skill HTTP 真相层
2. 实现 MCP adapter，优先覆盖 Codex / Cursor
3. 定义 OpenClaw 的 HTTP host profile
4. 定义 Claude Code 的 host profile
5. 每种宿主族至少做一次真实 agent 验收

这样可以用最小重复覆盖：

- Codex
- Cursor
- 很可能 Claude Code
- OpenClaw

## 12. 验收标准

只有满足以下条件，这个多宿主设计才算真正落地：

1. caller-skill 仍是单一 caller-side 真相层
2. 至少一个 MCP 宿主可以通过薄适配接入
3. 至少一个 HTTP skill 宿主可以通过薄适配接入
4. 没有任何宿主桥复制 hotline 业务逻辑
5. 支持宿主之间看到的是同一套 6 动作
6. 至少一个真实 agent 能完成 search -> read -> prepare -> send -> consume result
