# Caller Skill 设计稿

> 英文版：caller-remote-hotline-skills.md
> 中文文档为准。

状态：Planned  
更新时间：2026-04-01

本文档定义 `client` 中 agent 使用 hotline 的下一版 `caller-skill` 设计。

本文档只面向 Caller 侧，不面向 Responder 运行时，也不是终端用户通过 `ops` 使用产品的主流程。本文描述的是位于 `caller-controller` 之上的 agent 桥接层。

当前范围：

- 仅 local mode
- 暂不处理 platform 供应商选择
- 不新增 protocol 字段

## 1. 目标

Agent 不应直接学习这套底层 Caller 协议步骤：

- 搜索 catalog
- 读取 contract
- create request
- prepare
- dispatch
- poll
- read result

正确分层应是：

1. `caller-controller` 继续作为 request 生命周期真相层
2. `caller-skill-adapter` 继续作为 agent bridge
3. `caller-skill` 作为正式 agent-facing 接口

## 2. 设计原则

### 2.1 渐进式披露

Agent 不应过早读到完整 catalog 或过长 contract。

正确顺序应是：

1. 粗搜索
2. 小范围比较
3. 完整读取 hotline
4. 准备 request
5. 发送
6. 回报结果

### 2.2 搜索与读取不要求死板顺序

搜索和读取阶段不要求只有一个固定顺序。

允许：

- brief search 后再 detailed search
- 多次 brief search 再缩圈
- 读完某个 hotline 后退回搜索
- 读多个 hotline 后再决定

如果 agent 在读完某条 hotline 后不满意，应明确允许它退回：

- `search_hotlines_brief`
- `search_hotlines_detailed`

### 2.3 发送链路必须强制串行

一旦 agent 决定真的发送请求，链路必须变成强制顺序：

1. `read_hotline`
2. `prepare_request`
3. `send_request`
4. `report_response`

不允许绕过 `prepare_request`。

### 2.4 轮询由 adapter 负责

默认应由 adapter 轮询，不由模型轮询。

在普通 local mode 调用里：

- `send_request` 发出 prepared request
- adapter 内部轮询到终态
- adapter 把终态结果回给 agent

这样可把协议控制逻辑留在代码里。

## 3. Caller Skill 动作面

首版完整动作面定义为 6 个：

1. `search_hotlines_brief`
2. `search_hotlines_detailed`
3. `read_hotline`
4. `prepare_request`
5. `send_request`
6. `report_response`

## 4. 接口定义

## 4.1 `search_hotlines_brief`

用途：

- 在大搜索空间中做第一层模糊缩圈

输入：

```json
{
  "query": "summarize workspace repository",
  "task_goal": "find a local hotline that can summarize a workspace",
  "task_type": "text_summarize",
  "limit": 8
}
```

输出：

```json
{
  "items": [
    {
      "hotline_id": "local.delegated-execution.workspace-summary.v1",
      "display_name": "Workspace Summary",
      "short_description": "Summarize a local workspace repository",
      "task_types": ["text_summarize"],
      "source": "local",
      "match_reason": "matches workspace + summarize",
      "score": 0.94
    }
  ]
}
```

说明：

- 只返回短卡片，不返回完整 schema
- 目标是低上下文成本

## 4.2 `search_hotlines_detailed`

用途：

- 对少量候选做第二层详细比较，帮助 agent 选型

输入：

```json
{
  "hotline_ids": [
    "local.delegated-execution.workspace-summary.v1"
  ]
}
```

输出：

```json
{
  "items": [
    {
      "hotline_id": "local.delegated-execution.workspace-summary.v1",
      "display_name": "Workspace Summary",
      "description": "Summarize a workspace using local runtime",
      "input_summary": "Provide the workspace path and question",
      "output_summary": "Returns a structured summary result",
      "task_types": ["text_summarize"],
      "draft_ready": true,
      "local_only": true,
      "review_status": "local_only"
    }
  ]
}
```

说明：

- 仍然属于选型阶段，不属于正式填写阶段
- agent 做完这一步后仍然可以回退到 brief search

## 4.3 `read_hotline`

用途：

- 在选定 hotline 后，正式读取 caller-facing contract 和模板

输入：

```json
{
  "hotline_id": "local.delegated-execution.workspace-summary.v1"
}
```

输出：

```json
{
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "display_name": "Workspace Summary",
  "input_summary": "Provide workspace_path and question",
  "output_summary": "Returns structured summary output",
  "input_schema": {
    "type": "object",
    "required": ["workspace_path", "question"],
    "properties": {
      "workspace_path": {
        "type": "string",
        "description": "Absolute path to the workspace to inspect"
      },
      "question": {
        "type": "string",
        "description": "What the hotline should summarize or answer"
      }
    }
  },
  "output_schema": {
    "type": "object"
  }
}
```

说明：

- 这一步代表 agent 正式进入填写/准备阶段
- 如果这时发现不适合，也允许回退到 1/2

## 4.4 `prepare_request`

用途：

- 在发送前，根据 hotline 模板/schema 对候选输入做解析、校验、规范化

这一步是强制步骤。

输入：

```json
{
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "input": {
    "workspace_path": "/tmp/demo",
    "question": "Summarize the repo structure"
  },
  "agent_session_id": "agent_123"
}
```

失败输出：

```json
{
  "prepared_request_id": "prep_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "draft",
  "normalized_input": {
    "workspace_path": "/tmp/demo"
  },
  "errors": [
    {
      "field": "question",
      "code": "REQUIRED_FIELD_MISSING",
      "message": "question is required"
    }
  ],
  "warnings": [],
  "review": {
    "required": false,
    "status": "not_required"
  },
  "expires_at": "2026-04-02T12:00:00Z"
}
```

成功输出：

```json
{
  "prepared_request_id": "prep_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "ready",
  "normalized_input": {
    "workspace_path": "/tmp/demo",
    "question": "Summarize the repo structure"
  },
  "errors": [],
  "warnings": [],
  "review": {
    "required": false,
    "status": "not_required"
  },
  "expires_at": "2026-04-02T12:00:00Z"
}
```

校验职责：

- 必填项缺失
- 多余字段
- 类型错误
- 枚举值错误
- 字符/格式错误
- 明显空值
- 长度/范围错误

未来扩展：

- call 审核/审批应挂在 `prepare_request`

## 4.5 `send_request`

用途：

- 发送已经准备好的 request

`send_request` 直接复用 `prepare_request` 填好的内容，不再接受原始输入。

输入：

```json
{
  "prepared_request_id": "prep_123",
  "wait": true
}
```

`wait=true` 输出：

```json
{
  "request_id": "req_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "SUCCEEDED",
  "result": {
    "summary": "..."
  },
  "result_package": {
    "status": "ok",
    "output": {
      "summary": "..."
    }
  },
  "error": null
}
```

`wait=false` 输出：

```json
{
  "request_id": "req_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "PENDING"
}
```

规则：

- 只允许发送 `status=ready` 的 prepared request
- adapter 复用持久化的 normalized input
- 发送后将 prepared request 标记为 `sent`

## 4.6 `report_response`

用途：

- 读取 request 的终态，并整理成适合 agent 继续工作的结果

输入：

```json
{
  "request_id": "req_123"
}
```

输出：

```json
{
  "request_id": "req_123",
  "status": "SUCCEEDED",
  "result": {
    "summary": "..."
  },
  "result_package": {
    "status": "ok",
    "output": {
      "summary": "..."
    }
  },
  "error": null,
  "human_summary": "Workspace summary completed successfully"
}
```

说明：

- 如果 `send_request(wait=true)` 已经拿到终态，`report_response` 可以作为内部步骤
- 如果 `wait=false`，则 `report_response` 是显式后续动作

## 5. Prepared Request 持久化

`prepare_request` 应持久化一个短期本地对象：`prepared_request`。

它不是协议真相层，只是 caller-skill 的本地状态。

建议存储位置：

- `DELEXEC_HOME/prepared-requests/`

建议文件形态：

- 一条 prepared request 一个文件
- 例如：
  - `DELEXEC_HOME/prepared-requests/prep_123.json`

## 5.1 状态模型

允许状态：

- `draft`
- `ready`
- `sent`
- `expired`
- `invalidated`

含义：

- `draft`：已解析，但尚未通过校验
- `ready`：已通过校验，可发送
- `sent`：已绑定真实 `request_id`
- `expired`：TTL 失效
- `invalidated`：被新版本取代

## 5.2 建议记录结构

```json
{
  "prepared_request_id": "prep_123",
  "hotline_id": "local.delegated-execution.workspace-summary.v1",
  "status": "ready",
  "normalized_input": {},
  "errors": [],
  "warnings": [],
  "review": {
    "required": false,
    "status": "not_required"
  },
  "request_id": null,
  "created_at": "2026-04-01T12:00:00Z",
  "updated_at": "2026-04-01T12:00:00Z",
  "expires_at": "2026-04-02T12:00:00Z",
  "source_agent_session_id": "agent_123"
}
```

## 5.3 清理规则

建议采用：

1. TTL 过期
   - `draft` / `ready` 短期过期
2. 发送后失效
   - 发送后转为 `sent`
3. 新版本作废旧版本
   - 新 prepare 结果可将旧 pending 结果标记为 `invalidated`
4. 周期 GC
   - 定期删除旧的 `sent` / `expired` / `invalidated`

## 6. 编排规则

搜索和读取阶段不要求只有一个固定顺序。

允许：

- brief search -> detailed search -> read
- brief search -> read -> 回退 brief search
- brief search -> detailed search -> read -> 回退 detailed search

但请求执行阶段必须强制串行：

1. `read_hotline`
2. `prepare_request`
3. `send_request`
4. `report_response`

不允许从搜索结果直接发送。

## 7. 轮询策略

默认策略：

- adapter 轮询
- agent 不轮询

原因：

- polling 属于确定性控制逻辑
- 不应占用模型上下文
- 可让 agent 保持任务级推理

终态：

- `SUCCEEDED`
- `FAILED`
- `UNVERIFIED`
- `TIMED_OUT`

## 8. Local Mode 与 Platform Mode 边界

本文档只覆盖 local mode。

local mode 的选型关注：

- 能力匹配
- contract 匹配
- 本地可用性

未来 platform mode 需要把 detailed search/read 扩成供应商选择模型，纳入：

- responder 质量
- hotline 运营表现
- 成功率
- 延迟
- 专业性
- 审核状态
- 服务质量 / SLA

这不属于本文档范围。

## 9. 与现有实现的映射

建议继续以：

- [apps/caller-skill-adapter/src/server.js](/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/apps/caller-skill-adapter/src/server.js)
- [packages/caller-controller-core/src/index.js](/Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client/packages/caller-controller-core/src/index.js)

作为实现基础。

当前可复用的现有入口：

- `GET /skills/remote-hotline/catalog`
- `POST /skills/remote-hotline/invoke`
- `GET /skills/remote-hotline/requests/:requestId`

下一步建议：

- 把现有 `remote-hotline` 面收口成本文定义的 6 个渐进式动作

## 10. 验收标准

只有满足以下条件，local mode 的 caller-skill 才算完成：

1. agent 能低上下文成本地缩小 hotline 候选范围
2. agent 能对少量候选做更详细比较
3. agent 能读取选中 hotline 的 contract
4. agent 能 prepare 并校验 request 输入
5. agent 只能发送 prepared input
6. adapter 能自动轮询到终态
7. agent 能消费结果并继续工作
8. 整条链路不依赖 platform
