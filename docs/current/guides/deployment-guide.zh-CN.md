# 部署指南

> 英文版：deployment-guide.md
> 说明：中文文档为准。

本指南覆盖 `platform`、`caller`、`responder` 的受支持部署形态。

## 当前 Client 定位

当前阶段下，`client` 仓库首先是一个**本地管理**产品：

- 本地 caller 初始化
- 本地 responder runtime
- 本地 hotline draft 管理
- 本地 hotline 发现与自调用

platform 发布和社区能力虽然在代码中仍有部分路径，但当前应视为后续流程，而不是主要安装入口。

当前协议/运行时基线：

- platform 返回请求级 `delivery-meta`，包含 `task_delivery` 与 `result_delivery`
- responder 结果邮件使用纯 JSON body；caller-controller 在上游暴露前会先解析并校验
- 文件输出可作为附件传输，并由签名 `artifacts[]` 描述
- `platform_inbox` 为后续演进预留，当前部署未实现

## 推荐安装路径

- `platform` 和 `relay`：优先 Docker/Compose
- 终端用户机器上的 `caller` 和 `responder`：在 npm 正式发布完成前，优先仓库内 `npm run ops -- ...`
- Docker/Compose 依然适用于 CI、本地集成与高级独立部署

## 支持的部署 Profile

- `deploy/platform`：platform API + PostgreSQL
- `deploy/public-stack`：platform + postgres + relay + operator gateway + edge ingress
- `deploy/ops`：终端用户包，caller 常驻，responder 为可选本地角色
- `deploy/relay`：共享 transport relay
- `deploy/caller`：独立 caller controller（默认 SQLite）
- `deploy/responder`：面向运维与 CI 的独立 responder controller
- `deploy/all-in-one`：本地集成栈

Profile 意图：

- `deploy/platform` 面向生产，不默认启用 bootstrap demo responders
- `deploy/public-stack` 是首个面向运维的公网入口组合
- `deploy/all-in-one` 仍是本地/演示场景预接线 actor 的首选

## Responder CLI 路径

推荐用户路径：

1. `npm install`
2. `npm run ops -- setup`
3. `npm run ops -- auth register --email you@example.com`
4. `npm run ops -- enable-responder`
5. `npm run ops -- add-example-hotline`
6. `npm run ops -- run-example --text "Summarize this request."`
7. `npm run ops -- doctor` / `npm run ops -- debug-snapshot`

手动兜底路径：

1. `npm install`
2. `npm run ops -- setup`
3. `npm run ops -- auth register --email you@example.com`
4. `npm run ops -- enable-responder`
5. `npm run ops -- add-example-hotline`
6. `npm run ops -- start`
7. `npm run ops -- run-example --text "Summarize this request."`

该路径会把本地 ops 状态写入 `~/.delexec`，启动本地 supervisor，并在当前安装形态可用时内部管理 relay。  
在拆分仓库源码集成形态中，优先使用指向 `delegated-execution-platform-selfhost` 中 relay 进程的 `relay_http`。参见 `docs/current/guides/source-integration-runbook.md`。  
本地运行时日志位于 `~/.delexec/logs`，`ops-console` 会读取日志与 debug snapshot。  
`ops-console` 提供 setup wizard，覆盖 caller 注册、官方示例安装、responder 启用、draft 查看和本地自调用。  
`ops-console` 还支持本地口令解锁流，敏感凭据保存在 `~/.delexec/secrets.enc.json`，而非浏览器存储。  
`enable-responder` 仅启用本地 responder 运行时；平台 review 控制目录可见性与远程可用性，不阻止本地运行时启动。

面向 coding-agent 的机器可读 bootstrap 输出，参见：

- [coding-agent-onboarding.md](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/docs/current/guides/coding-agent-onboarding.md)
- [end-user-ai-deployment-guide.md](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/docs/current/guides/end-user-ai-deployment-guide.md)
- [public-stack-operator-guide.md](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/docs/current/guides/public-stack-operator-guide.md)

## 镜像分发

每个部署 profile 接受：

- `IMAGE_REGISTRY`
- `IMAGE_TAG`

默认镜像名：

- `rsp-relay`
- `rsp-platform`
- `rsp-caller`
- `rsp-responder`

## Platform 管理员访问

若希望本地 `platform-console-gateway` 使用稳定运维凭据，请在 platform 部署设置 `PLATFORM_ADMIN_API_KEY`。

- `platform-console` 只应访问 `platform-console-gateway`
- `platform-console-gateway` 应使用 `PLATFORM_ADMIN_API_KEY`
- caller 凭据不再隐含运维权限
- 用户仍可通过 admin role-grant 接口后续授予 `admin`
- 浏览器不应直接持久化 operator API key；应存入本地加密密钥库并由 gateway 注入
- `deploy/platform` 应显式传入：
  - `PLATFORM_ADMIN_API_KEY`
  - 需要 relay `delivery-meta` 时传 `TRANSPORT_BASE_URL`
  - 隐藏 review 测试使用独立 relay 路径时传 `REVIEW_TRANSPORT_BASE_URL`

当前 compose 同时保留 `image` 与 `build`，以支持本地源码构建。  
在 registry 环境中，设置 `IMAGE_REGISTRY` 与 `IMAGE_TAG` 指向已发布镜像坐标。

当前仓库默认镜像命名空间：

- `ghcr.io/hejiajiudeeyu`

## Public Stack

当你希望获得单一面向运维的公网入口栈时，推荐使用 `deploy/public-stack`。

当前首版包含：

- `platform-api`
- `postgres`
- `relay`
- `platform-console-gateway`
- `caddy` 边缘入口

当前公开路由：

- `/platform/*`
- `/relay/*`
- `/gateway/*`

当前限制：

- `platform-console` 前端尚未打包进 `public-stack`；当前栈主要暴露 operator gateway API 与核心后端服务
- 完整运维 bootstrap 流程见 [public-stack-operator-guide.md](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/docs/current/guides/public-stack-operator-guide.md)

推荐冒烟验证拆分：

- 源码构建路径：`npm run test:compose-smoke`
- 公网入口栈路径：`npm run test:public-stack-smoke`
- 本地 release 形态镜像路径：`npm run test:local-images-smoke`
- 已发布 GHCR 镜像路径：`npm run test:published-images-smoke`
- 手动 GHCR 验证 workflow：`.github/workflows/published-images-smoke.yml`

当前 `compose-smoke` runner：

- 若未显式设置 `COMPOSE_PROJECT_NAME`，每次运行都会生成隔离项目名
- 启动前先执行 `docker compose config` 校验
- 对同项目做预清理，减少重复本地运行抖动
- `up` 前预热所需镜像，区分缓存命中与显式拉取
- 对临时 `image_pull_failed` 启动失败做有限次重试（`COMPOSE_IMAGE_PULL_RETRIES`，默认 `2`）
- 区分 registry 鉴权、镜像拉取、端口冲突、服务运行失败、健康超时、数据库启动与业务链路回归等失败类别

## Relay

Relay 是部署模式下 caller 与 responder controller 之间共享的 transport 运行时。

对终端用户 ops 客户端，relay 默认由本地 supervisor 启动和管理。  
独立 relay 部署主要用于 CI、本地集成与高级运维场景。

- Caller 与 responder 均要求 `TRANSPORT_BASE_URL`
- 隐藏 admin review 测试若设置 `REVIEW_TRANSPORT_BASE_URL` 则优先使用；否则 platform 回退到 `TRANSPORT_BASE_URL`
- relay 可通过 `RELAY_SQLITE_PATH` 启用 SQLite 持久化
- `local://relay/<receiver>/...` 地址会解析到 relay receivers

## 邮件 Transport

`ops-console` 现在除 `local` 与 `relay_http` 外，也支持一方维护的 `email` transport 选项。

传输选择模型：

- `local`：默认本地 supervisor 管理 relay 路径
- `relay_http`：外部 relay endpoint
- `email`：邮箱驱动 transport

`email` 在当前代码库支持的 provider：

- `emailengine`
- `gmail`

当前实现范围：

- 单邮箱 / 共享邮箱
- 基于轮询的 inbox 消费
- 邮件正文中的签名 JSON payload
- 附件承载 artifacts
- 使用 console session 流时，密钥存入本地加密 `~/.delexec/secrets.enc.json`
- 迁移完成前，为 CLI-only/bootstrap 兼容保留 `.env.local` 旧兜底

## 本地密钥存储

终端用户安装路径下当前本地文件布局：

- `~/.delexec/ops.config.json`：非敏感本地运行时配置
- `~/.delexec/.env.local`：兼容环境文件，逐步去敏
- `~/.delexec/secrets.enc.json`：本地口令解锁的加密密钥库

当前实现使用：

- `scrypt` 密钥派生
- `AES-256-GCM` 加密负载
- 在解密后的内存密钥之上提供短时本地 console session

这是当前 L0/L9 基线。其安全性强于明文 env/浏览器存储，但仍不是 OS keychain 级密钥管理器。

当前实现使用的 provider 参考与版本：

- EmailEngine: [EmailEngine API docs](https://learn.emailengine.app/docs/email-api)
  - 文档页当前标注 `EmailEngine API 2.62.0`
  - 仓库实现使用 `/v1` 下的 REST `API v1` 端点
- Gmail: [Gmail API REST reference](https://developers.google.com/workspace/gmail/api/reference/rest)
  - 仓库实现使用 `gmail/v1`

实现细节：

- EmailEngine 适配器：[index.js](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/packages/transports/emailengine/src/index.js)
- Gmail 适配器：[index.js](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/packages/transports/gmail/src/index.js)
- 共享邮件 envelope helper：[index.js](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/packages/transports/email/src/index.js)

更多配置参考：

- [EmailEngine integration notes](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/docs/current/guides/integrations/emailengine.md)
- [Gmail API integration notes](/Users/hejiajiudeeyu/Documents/Projects/remote-hotline-protocol/docs/current/guides/integrations/gmail-api.md)

## 存储选型

### Platform

- 推荐：PostgreSQL
- 原因：platform 状态是共享控制面状态，不应依赖单节点 SQLite

### Caller

- 默认：通过 `SQLITE_DATABASE_PATH` 使用 SQLite
- 推荐升级路径：当 caller 需要跨容器替换或接入外部运维工具时设置 `DATABASE_URL`
- 优先级：`DATABASE_URL` 覆盖 `SQLITE_DATABASE_PATH`

### Responder

- 默认：通过 `SQLITE_DATABASE_PATH` 使用 SQLite
- 推荐升级路径：多实例或生产持久运行时设置 `DATABASE_URL`
- 优先级：`DATABASE_URL` 覆盖 `SQLITE_DATABASE_PATH`

## Responder 签名密钥

本地演示可选 responder signing，但非演示部署应视为必需。

请成对配置：

- `RESPONDER_SIGNING_PUBLIC_KEY_PEM`
- `RESPONDER_SIGNING_PRIVATE_KEY_PEM`

规则：

- 不要只提供其中一个值；密钥对不完整会导致启动失败
- 在 `.env` 中使用转义换行编码多行 PEM 值
- 优先通过运行平台注入密钥，不要把 PEM 提交进环境文件

示例格式：

```env
RESPONDER_SIGNING_PUBLIC_KEY_PEM=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
RESPONDER_SIGNING_PRIVATE_KEY_PEM=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

`platform` bootstrap 模式对应变量：

- `ENABLE_BOOTSTRAP_RESPONDERS`
- `BOOTSTRAP_RESPONDER_PUBLIC_KEY_PEM`
- `BOOTSTRAP_RESPONDER_PRIVATE_KEY_PEM`
- `BOOTSTRAP_RESPONDER_API_KEY`
- `BOOTSTRAP_TASK_DELIVERY_ADDRESS`

将 `platform` 与 `responder` 分开部署时，请在两侧使用相同 responder 身份和密钥对。  
面向生产的 `deploy/platform` 默认应关闭 bootstrap responders，除非你刻意运行预接线演示环境。

## 部署建议

- `platform`：作为服务端镜像发布并部署，搭配托管 PostgreSQL
- `public-stack`：需要单一公网运维包时优先
- `caller`：既支持容器部署也支持直接嵌入；标准化运维场景优先 Docker
- `responder`：终端用户机器优先 `npm run ops -- ...`，运维管理的独立服务场景使用容器部署

## 发布形态

推荐镜像标签模型：

- 不可变标签：git SHA
- 可读标签：发布版本，如 `0.1.0`
- 可选渠道标签：`latest`

推荐发布顺序：

1. 发布共享测试结果
2. 发布 `rsp-platform`、`rsp-caller`、`rsp-responder`
3. 将部署示例更新到已发布的 `IMAGE_TAG`
