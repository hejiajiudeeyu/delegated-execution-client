# Codex 本地接入 Caller Skill MCP 指南

状态：Draft
更新：2026-04-02

本文档说明如何在本地模式下，通过 MCP adapter 把 Codex 接到 `caller-skill`。

## 1. 目标

完成后，Codex 应能看到并调用这些 MCP tools：

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

默认 caller-skill HTTP base URL：

- `http://127.0.0.1:8091`

可先验证：

```bash
curl http://127.0.0.1:8091/healthz
curl http://127.0.0.1:8091/skills/caller/manifest
```

## 3. 启动 MCP adapter

在仓库根目录执行：

```bash
npm run caller-skill:mcp
```

如果本地 caller-skill server 不在默认端口，可改为：

```bash
CALLER_SKILL_BASE_URL=http://127.0.0.1:9191 npm run caller-skill:mcp
```

## 4. 在 Codex 里注册

把这个 MCP server 注册成一个 stdio 命令：

```bash
node /absolute/path/to/repos/client/apps/caller-skill-mcp-adapter/src/server.js
```

建议同时提供环境变量：

- `CALLER_SKILL_BASE_URL=http://127.0.0.1:8091`

## 5. 预期工具行为

Codex 应该能看到 6 个 tools。

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

## 6. 第一条验证任务

可先用本地 example hotline：

- `local.delegated-execution.workspace-summary.v1`

验证 Codex 是否能：

1. 找到该 hotline
2. 读取 hotline contract
3. 准备 request
4. 发送 prepared request
5. 收到终态结果

## 7. 当前范围

本文档只覆盖：

- local mode
- Codex + MCP

暂不覆盖：

- platform mode 的供应商选择
- `prepare_request` 里的审核/审批
- Cursor / Claude Code 的宿主细节
