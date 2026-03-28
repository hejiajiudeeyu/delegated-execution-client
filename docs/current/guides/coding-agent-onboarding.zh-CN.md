# 编码代理上手指南

> 英文版：coding-agent-onboarding.md
> 说明：中文文档为准。

本仓库现在提供了稳定的本地演示路径，供 coding agent 使用。

最短 bootstrap 路径：

```bash
npm install -g @delexec/ops
delexec-ops bootstrap --email coding-agent@local.test --platform http://127.0.0.1:8080
```

包装脚本仍可用，并委托到同一套 CLI 流程：

```bash
node scripts/coding-agent-bootstrap.mjs --email coding-agent@local.test --platform http://127.0.0.1:8080
```

bootstrap 流程会尝试完成：

1. `delexec-ops setup`
2. caller 注册
3. 安装官方示例 hotline
4. 提交 responder 审核
5. 启用 responder
6. 启动 supervisor
7. 当本地运维环境具备 `PLATFORM_ADMIN_API_KEY` 时完成 responder/hotline 审批
8. 按正常 caller -> responder 协议路径执行本地示例自调用

推荐环境变量：

```bash
export PLATFORM_API_BASE_URL=http://127.0.0.1:8080
export PLATFORM_ADMIN_API_KEY=sk_admin_xxx
export BOOTSTRAP_CALLER_EMAIL=coding-agent@local.test
```

`PLATFORM_ADMIN_API_KEY` 用于本地 bootstrap 自动化或 `platform-console-gateway`，浏览器客户端不应直接存储或使用该密钥。

成功判定：

- 输出为 JSON
- `steps` 包含 `setup_ok`、`caller_registered`、`example_hotline_added`、`review_submitted`、`responder_enabled`
- 终端成功返回：

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "status": "SUCCEEDED"
}
```

若缺少管理员审批，命令将以以下阶段退出：

- `stage: "awaiting_admin_approval"`

常用后续命令：

```bash
delexec-ops add-example-hotline
delexec-ops run-example --text "Summarize this request."
```

常用日志与快照：

- 本地 ops 主目录：`~/.delexec`
- 运行时日志：`~/.delexec/logs`
- 调试快照：`GET http://127.0.0.1:8079/debug/snapshot`
- supervisor 状态：`GET http://127.0.0.1:8079/status`
