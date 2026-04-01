# Agent 本地安装剧本

当你希望让一个 agent 从源码安装并验证当前 `client` 产品主路径时，使用这份剧本。

这份剧本刻意限定为：

- 只走本地模式
- 不走 platform 审核
- 不发布到 platform catalog
- 不执行 `submit-review`
- 不启动 Docker

## Agent 需要完成什么

agent 应完成这条本地闭环：

1. 在 `client` 仓库安装依赖
2. 使用隔离的 `DELEXEC_HOME` 启动本地运行时
3. 初始化本地 secret store
4. 注册本地 caller
5. 启用本地 responder runtime
6. 添加官方示例 hotline
7. 查看生成的 draft
8. 发起一次本地示例自调用，直到到达 `SUCCEEDED`

## 仓库来源

默认 GitHub 仓库：

```bash
git@github.com:hejiajiudeeyu/delegated-execution-client.git
```

示例 clone 流程：

```bash
git clone git@github.com:hejiajiudeeyu/delegated-execution-client.git
cd delegated-execution-client
```

## 运行前假设

agent 应假设：

- 本机有 Node.js 和 `corepack`
- 通过 `corepack` 使用 `pnpm`
- 这条流程不需要 platform
- 当前产品主路径是本地优先

## 推荐隔离环境

agent 应使用隔离的本地状态目录和非默认端口：

```bash
export DELEXEC_HOME="$HOME/.delexec-agent-local-install"
export OPS_PORT_SUPERVISOR=8179
export OPS_PORT_CALLER=8181
export OPS_PORT_RESPONDER=8182
export OPS_PORT_RELAY=8190
export OPS_PORT_SKILL_ADAPTER=8191
```

## 安装与启动

```bash
git clone git@github.com:hejiajiudeeyu/delegated-execution-client.git
cd delegated-execution-client
corepack pnpm install

DELEXEC_HOME="$DELEXEC_HOME" \
OPS_PORT_SUPERVISOR="$OPS_PORT_SUPERVISOR" \
OPS_PORT_CALLER="$OPS_PORT_CALLER" \
OPS_PORT_RESPONDER="$OPS_PORT_RESPONDER" \
OPS_PORT_RELAY="$OPS_PORT_RELAY" \
OPS_PORT_SKILL_ADAPTER="$OPS_PORT_SKILL_ADAPTER" \
corepack pnpm --filter @delexec/ops exec node src/cli.js start
```

机器本地的 hotline 状态应集中放在 `DELEXEC_HOME` 下：

- `ops.config.json`
- `hotline-registration-drafts/`
- `hotline-integrations/`
- `hotline-hooks/`

不要把热线专用命令、URL、路径或 hook 文件写进 git 工作区。

## 初始化本地模式

```bash
curl -X POST http://127.0.0.1:8179/setup \
  -H 'content-type: application/json' \
  -d '{}'

curl -X POST http://127.0.0.1:8179/auth/session/setup \
  -H 'content-type: application/json' \
  -d '{"passphrase":"agent-local-install-123"}'
```

保存返回的 token：

```bash
export OPS_SESSION="<返回的 token>"
```

## 注册 Caller

```bash
curl -X POST http://127.0.0.1:8179/auth/register-caller \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{"contact_email":"agent-local@example.com"}'
```

## 启用本地 Responder

```bash
curl -X POST http://127.0.0.1:8179/responder/enable \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{"responder_id":"agent-local-responder","display_name":"Agent Local Responder"}'
```

## 添加第一条 Hotline

```bash
curl -X POST http://127.0.0.1:8179/responder/hotlines/example \
  -H 'content-type: application/json' \
  -d '{}'
```

预期 hotline ID：

```bash
local.delegated-execution.workspace-summary.v1
```

## 查看 Draft

```bash
curl http://127.0.0.1:8179/responder/hotlines/local.delegated-execution.workspace-summary.v1/draft \
  -H "X-Ops-Session: $OPS_SESSION"
```

agent 应确认：

- `platform_enabled = false`
- `review_status = local_only`
- `draft_ready = true`
- 每个输入字段都在 `input_schema.properties.<field>.description` 中提供面向 Caller 的填写说明
- `hotline-integrations/` 下存在本机 integration 文件
- `hotline-hooks/` 下存在本机 hook stub

## 发起第一条本地 Call

```bash
curl -X POST http://127.0.0.1:8179/requests/example \
  -H 'content-type: application/json' \
  -H "X-Ops-Session: $OPS_SESSION" \
  -d '{}'
```

然后轮询：

```bash
curl http://127.0.0.1:8179/requests/<request_id>/result \
  -H "X-Ops-Session: $OPS_SESSION"
```

## 成功判定

只有满足以下条件，agent 才应报告成功：

- 本地 setup 成功
- caller 注册成功
- 本地 responder 启用成功
- 示例 hotline 已存在
- draft 可读
- 示例自调用到达 `SUCCEEDED`
- 结果包可读且带签名

## 给另一个 Agent 的提示模板

你可以直接给另一个 agent 这样的指令：

```text
从源码安装并验证本地模式的 client 流程。

仓库：
git@github.com:hejiajiudeeyu/delegated-execution-client.git

要求：
1. 只走本地模式
2. 不启动 platform，不启动 Docker
3. 使用隔离的 DELEXEC_HOME
4. 完成 setup、caller 注册、responder 启用、第一条示例 hotline 创建、draft 查看，以及一次成功的本地自调用
5. 返回 supervisor status URL、hotline ID、draft 路径和 request ID
```

## 不要做什么

agent 不应：

- 在这条流程里启动 platform
- 执行 `submit-review`
- 把 platform 审批当作前置条件
- 修改协议字段
- 在提交到仓库的测试样例中使用真实个人数据
