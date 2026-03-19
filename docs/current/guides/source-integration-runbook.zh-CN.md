# 源码集成运行手册

> 英文版：source-integration-runbook.md
> 说明：中文文档为准。

本手册覆盖当前拆分仓库下的源码集成路径：

- 服务端来自 `delegated-execution-platform-selfhost`
- 客户端来自 `delegated-execution-client`

## 目标

使用以下组件验证端到端请求链路：

- `deploy/platform`（platform API + PostgreSQL）
- 来自平台仓库的独立 relay 进程
- 来自客户端仓库源码形态的 `delexec-ops`

## 1. 启动 Platform

在 `delegated-execution-platform-selfhost` 中：

```bash
npm install
cp deploy/platform/.env.example deploy/platform/.env
```

至少设置：

```env
TOKEN_SECRET=replace-with-a-local-dev-secret
PLATFORM_ADMIN_API_KEY=sk_admin_local_dev
```

然后启动：

```bash
docker compose -f deploy/platform/docker-compose.yml --env-file deploy/platform/.env up -d --build
curl http://127.0.0.1:8080/healthz
```

预期返回：

```json
{"ok":true,"service":"platform-api"}
```

## 2. 启动 Relay

在 `delegated-execution-platform-selfhost` 中：

```bash
PORT=8090 SERVICE_NAME=transport-relay RELAY_SQLITE_PATH=/tmp/delexec-relay.sqlite npm --workspace @delexec/transport-relay run start
```

预期输出：

```text
[transport-relay] listening on 8090
```

健康检查：

```bash
curl http://127.0.0.1:8090/healthz
```

## 3. Bootstrap 源码客户端

在 `delegated-execution-client` 中：

```bash
npm install
export PLATFORM_ADMIN_API_KEY=sk_admin_local_dev
export TRANSPORT_TYPE=relay_http
export TRANSPORT_BASE_URL=http://127.0.0.1:8090
npm --workspace @delexec/ops run start -- bootstrap --email you@example.com --platform http://127.0.0.1:8080 --text "Summarize this request in one sentence."
```

重要说明：

- 在拆分后的源码布局中，客户端仓库已不再包含 relay 源码包
- 因此源码集成应使用 `relay_http`，并指向平台仓库启动的 relay 进程

## 4. 审批 Seller 与 Subagent

若 bootstrap 报告审批待处理，在平台侧审批两个对象：

```bash
curl -X POST http://127.0.0.1:8080/v1/admin/sellers/<seller_id>/approve \
  -H 'Authorization: Bearer sk_admin_local_dev' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual integration approval"}'

curl -X POST http://127.0.0.1:8080/v1/admin/subagents/local.summary.v1/approve \
  -H 'Authorization: Bearer sk_admin_local_dev' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual integration approval"}'
```

## 5. 运行示例请求

在 `delegated-execution-client` 中：

```bash
npm --workspace @delexec/ops run start -- run-example --text "Summarize this request in one sentence."
npm --workspace @delexec/ops run start -- status
```

成功标准：

- relay 健康检查返回 `200`
- buyer 与 seller 进程健康
- 最新请求状态变为 `SUCCEEDED`

## 6. 失败时检查项

客户端侧：

```bash
npm --workspace @delexec/ops run start -- status
npm --workspace @delexec/ops run start -- debug-snapshot
```

平台侧：

```bash
docker compose -f deploy/platform/docker-compose.yml --env-file deploy/platform/.env logs --tail=200 platform-api
```

relay 侧：

```bash
curl http://127.0.0.1:8090/healthz
```
