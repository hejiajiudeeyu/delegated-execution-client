# 本地模式上手指南

当你只想验证 `client` 仓库本地闭环能力时，使用这份指南：

- 不走 platform 审核
- 不发布到 platform catalog
- 不执行 `submit-review`

本指南验证的是：

1. 本地初始化与解锁
2. Caller 注册
3. 本地 Responder 启用
4. 本地 Hotline draft 生成
5. 本地 Hotline 发现
6. 本地示例自调用

## 适用范围

本地模式表示：

- `platform.enabled = false`
- responder hotline 保持 `local_only`
- draft 仍然存在，并且是热线主配置视图
- caller 直接发现同机本地 hotline

机器本地的 hotline 状态统一放在 `DELEXEC_HOME` 下，而不是仓库目录里：

- `ops.config.json`：本地运行时快照
- `hotline-registration-drafts/`：面向 Caller 的热线 draft
- `hotline-integrations/`：本机命令、URL、项目路径等接入配置
- `hotline-hooks/`：可选的本机 hook stub

## 准备

在 `client` 仓库下执行：

```bash
cd /Users/hejiajiudeeyu/Documents/Projects/delegated-execution-dev/repos/client
corepack pnpm install
```

建议使用独立本地目录，避免和现有环境混用：

```bash
export DELEXEC_HOME="$HOME/.delexec-client-localtest"
export OPS_PORT_SUPERVISOR=8179
export OPS_PORT_CALLER=8181
export OPS_PORT_RESPONDER=8182
export OPS_PORT_RELAY=8190
export OPS_PORT_SKILL_ADAPTER=8191
```

## 启动本地运行时

```bash
DELEXEC_HOME="$DELEXEC_HOME" \
OPS_PORT_SUPERVISOR="$OPS_PORT_SUPERVISOR" \
OPS_PORT_CALLER="$OPS_PORT_CALLER" \
OPS_PORT_RESPONDER="$OPS_PORT_RESPONDER" \
OPS_PORT_RELAY="$OPS_PORT_RELAY" \
OPS_PORT_SKILL_ADAPTER="$OPS_PORT_SKILL_ADAPTER" \
corepack pnpm --filter @delexec/ops exec node src/cli.js start
```

检查状态：

```bash
curl http://127.0.0.1:8179/status
```

预期：

- `platform.enabled` 为 `false`
- `setup_required` 为 `true`
- responder 还未启用
- 当前没有已配置 hotline

## 初始化本地 secret store

初始化运行时状态：

```bash
curl -X POST http://127.0.0.1:8179/setup \
  -H 'content-type: application/json' \
  -d '{}'
```

设置本地 passphrase：

```bash
curl -X POST http://127.0.0.1:8179/auth/session/setup \
  -H 'content-type: application/json' \
  -d '{"passphrase":"client-localtest-123"}'
```

保存返回的 token：

```bash
export OPS_SESSION="<返回的 token>"
```

## 注册本地 Caller

```bash
curl -X POST http://127.0.0.1:8179/auth/register-caller \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{"contact_email":"localtest@example.com"}'
```

预期：

- 返回 `user_id`
- 生成本地 caller API key
- `roles` 包含 `caller`

## 启用本地 Responder Runtime

```bash
curl -X POST http://127.0.0.1:8179/responder/enable \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{"responder_id":"client-local-responder","display_name":"Client Local Responder"}'
```

这一步只是启用**本地 responder runtime**，不代表已经发布到 platform。

## 添加官方示例 Hotline

```bash
curl -X POST http://127.0.0.1:8179/responder/hotlines/example \
  -H 'content-type: application/json' \
  -d '{}'
```

预期：

- `hotline_id = local.delegated-execution.workspace-summary.v1`
- 返回 `registration_draft_file`
- 返回 `local_integration_file`
- 返回 `local_hook_file`
- 示例 hotline 已在本地启用

## 查看本地 draft

```bash
curl http://127.0.0.1:8179/responder/hotlines/local.delegated-execution.workspace-summary.v1/draft \
  -H "X-Ops-Session: $OPS_SESSION"
```

预期：

- `platform_enabled = false`
- `review_status = local_only`
- `submitted_for_review = false`
- `draft_ready = true`

在本地模式下，draft 就是热线主配置视图。重点检查：

- `description`
- `summary`
- `input_schema.properties.<field>.description`
- `output_schema`
- `input_summary`
- `output_summary`

每个输入字段都必须有面向 Caller 的填写说明。

同时检查 `DELEXEC_HOME` 下的本地接入文件：

- `hotline-integrations/<hotline-id>.integration.json`
- `hotline-hooks/<hotline-id>.hooks.json`

把机器相关命令、URL、路径和 hook 都放在这里，避免误进入 git 跟踪范围。

## 验证本地发现

```bash
curl http://127.0.0.1:8179/catalog/hotlines \
  -H "X-Ops-Session: $OPS_SESSION"
```

预期：

- 能看到示例 hotline
- `catalog_visibility = "local"`
- `source = "local"`
- `review_status = "local_only"`

## 发起本地示例调用

```bash
curl -X POST http://127.0.0.1:8179/requests/example \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{}'
```

保存返回的 request ID：

```bash
export REQUEST_ID="<返回的 request_id>"
```

读取结果：

```bash
curl http://127.0.0.1:8179/requests/$REQUEST_ID/result \
  -H "X-Ops-Session: $OPS_SESSION"
```

预期：

- `available = true`
- `status = "SUCCEEDED"`
- `result_package.status = "ok"`
- 返回里带签名字段

## 完成判断

满足以下条件，就说明 `client` 本地模式上手闭环正常：

- 本地初始化与解锁成功
- Caller 注册成功
- 本地 Responder 已启用
- 示例 hotline 已生成 draft
- 本地 catalog 发现正常
- 示例自调用到达 `SUCCEEDED`

## 本指南不覆盖

这份指南有意不覆盖：

- platform review 提交
- platform 审批
- platform catalog 发布
- relay / email 部署形态

如果本地模式已经正常，再继续阅读 platform 相关指南。
