# Cursor 本地接入 Caller Skill MCP 指南

状态：Draft
更新：2026-04-02

本文档说明如何在本地模式下，通过 MCP adapter 把 Cursor 接到 `caller-skill`。

Cursor 默认应优先使用 `streamable_http`。

## 1. 目标

完成后，Cursor 应能看到并调用这些 MCP tools：

- `caller_skill.search_hotlines_brief`
- `caller_skill.search_hotlines_detailed`
- `caller_skill.read_hotline`
- `caller_skill.prepare_request`
- `caller_skill.send_request`
- `caller_skill.report_response`

业务真相仍然在本地 caller-skill HTTP surface，MCP adapter 只负责把它翻译成 MCP tools。

## 2. 前置条件

本地 client runtime 必须已经以 local mode 运行：

```bash
npm run ops -- start
```

然后读取 MCP 注册信息：

```bash
delexec-ops mcp spec
```

预期重点字段：

- `preferred_transport = streamable_http`
- `streamable_http.url`
- `streamable_http.health_url`

默认 caller-skill HTTP base URL：

- `http://127.0.0.1:8091`

默认 MCP health check：

- `http://127.0.0.1:8092/healthz`

## 3. 在 Cursor 里注册

以 `delexec-ops mcp spec` 返回的 `streamable_http.url` 为准进行注册。

如果 Cursor 里已经存在旧的 `caller_skill` MCP 配置，先移除旧配置。

然后以以下方式注册：

- transport: `streamable_http`
- URL: `http://127.0.0.1:8092/mcp`

如果你的本地端口不同，请以 spec 输出结果为准，不要写死默认端口。

## 4. 预期工具行为

Cursor 应该能看到 6 个 tools。

搜索与读取阶段：

- 顺序灵活
- 读完 hotline 后如果不满意，可以回退到搜索

执行阶段：

- `read_hotline`
- `prepare_request`
- `send_request`
- `report_response`

执行阶段必须严格串行。

`send_request` 只应接收 `prepared_request_id`。

轮询应留在 adapter / caller-skill 层，不应让模型自己做。

## 5. 第一条验证任务

可先用本地 example hotline：

- `local.delegated-execution.workspace-summary.v1`

验证 Cursor 是否能：

1. 找到该 hotline
2. 读取 hotline contract
3. 准备 request
4. 发送 prepared request
5. 收到终态结果

## 6. 当前范围

本文档只覆盖：

- local mode
- Cursor + MCP

暂不覆盖：

- platform mode 的供应商选择
- `prepare_request` 里的审核/审批
- Cursor 宿主更深的 UI 集成细节
