# 终端用户 AI 部署指南

> 英文版：end-user-ai-deployment-guide.md
> 说明：中文文档为准。

本指南描述当前受支持的路径：让 AI 协助终端用户安装并 bootstrap 本地客户端。

## 当前受支持的安装策略

面向用户的受支持安装路径是已发布的 CLI 包：

```bash
npm install -g @delexec/ops
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

## AI 应该做什么

推荐的 AI 流程：

1. 安装 `@delexec/ops`
2. 运行单条 bootstrap 命令
3. 检查 JSON 输出
4. 若审批待处理，明确告知用户或运维
5. 审批完成后，重新执行 bootstrap 或 `run-example`

## 单命令 Bootstrap

```bash
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

该流程会尝试：

1. 初始化 `~/.delexec`
2. 注册 caller
3. 安装官方示例 hotline
4. 提交 responder 与 hotline 审核
5. 启用本地 responder 运行时
6. 启动本地 supervisor
7. 执行本地示例自调用

## 预期输出

命令返回 JSON。AI 应读取 JSON，而不是以启发式方式解析 shell 文本。

成功形态：

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "status": "SUCCEEDED"
}
```

待审批形态：

```json
{
  "ok": false,
  "stage": "awaiting_admin_approval"
}
```

## 常用后续命令

```bash
delexec-ops run-example --text "Summarize this request."
delexec-ops doctor
delexec-ops debug-snapshot
```

## AI 应回报给用户的信息

AI 应仅总结以下用户相关结果：

- setup 是否完成
- caller 注册是否完成
- review 是否已提交
- responder 是否已启用
- 是否仍需管理员审批
- 示例请求是否成功

## 当前限制

- platform 必须已可访问
- responder 与 hotline 仍需管理员审批
- 邮件 transport 为可选项，不是 bootstrap 必需项
