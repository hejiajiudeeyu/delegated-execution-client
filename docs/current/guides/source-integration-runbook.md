# Source Integration Runbook

This runbook covers the current split-repository source integration path:

- server side from `delegated-execution-platform-selfhost`
- client side from `delegated-execution-client`

## Goal

Validate the end-to-end request path using:

- `deploy/platform` for the platform API and PostgreSQL
- a standalone relay process from the platform repository
- source `delexec-ops` from the client repository

## 1. Start The Platform

In `delegated-execution-platform-selfhost`:

```bash
npm install
cp deploy/platform/.env.example deploy/platform/.env
```

Set at least:

```env
TOKEN_SECRET=replace-with-a-local-dev-secret
PLATFORM_ADMIN_API_KEY=sk_admin_local_dev
```

Then start the stack:

```bash
docker compose -f deploy/platform/docker-compose.yml --env-file deploy/platform/.env up -d --build
curl http://127.0.0.1:8080/healthz
```

Expected result:

```json
{"ok":true,"service":"platform-api"}
```

## 2. Start The Relay

In `delegated-execution-platform-selfhost`:

```bash
PORT=8090 SERVICE_NAME=transport-relay RELAY_SQLITE_PATH=/tmp/delexec-relay.sqlite npm --workspace @delexec/transport-relay run start
```

Expected result:

```text
[transport-relay] listening on 8090
```

Health check:

```bash
curl http://127.0.0.1:8090/healthz
```

## 3. Bootstrap The Source Client

In `delegated-execution-client`:

```bash
npm install
export PLATFORM_ADMIN_API_KEY=sk_admin_local_dev
export TRANSPORT_TYPE=relay_http
export TRANSPORT_BASE_URL=http://127.0.0.1:8090
npm --workspace @delexec/ops run start -- bootstrap --email you@example.com --platform http://127.0.0.1:8080 --text "Summarize this request in one sentence."
```

Important note:

- in the split-repository source layout, the client repository no longer contains the relay source package
- source integration should therefore use `relay_http` pointed at a relay process started from the platform repository

## 4. Approve Responder And Hotline

If bootstrap reports pending approval, approve both objects from the platform side:

```bash
curl -X POST http://127.0.0.1:8080/v2/admin/responders/<responder_id>/approve \
  -H 'Authorization: Bearer sk_admin_local_dev' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual integration approval"}'

curl -X POST http://127.0.0.1:8080/v2/admin/hotlines/local.summary.v1/approve \
  -H 'Authorization: Bearer sk_admin_local_dev' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual integration approval"}'
```

## 5. Run The Example Request

In `delegated-execution-client`:

```bash
npm --workspace @delexec/ops run start -- run-example --text "Summarize this request in one sentence."
npm --workspace @delexec/ops run start -- status
```

Success criteria:

- relay health is `200`
- caller and responder processes are healthy
- the latest request status becomes `SUCCEEDED`

## 6. What To Check On Failure

Client side:

```bash
npm --workspace @delexec/ops run start -- status
npm --workspace @delexec/ops run start -- debug-snapshot
```

Platform side:

```bash
docker compose -f deploy/platform/docker-compose.yml --env-file deploy/platform/.env logs --tail=200 platform-api
```

Relay side:

```bash
curl http://127.0.0.1:8090/healthz
```
