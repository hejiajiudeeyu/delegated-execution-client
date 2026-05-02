# 测试策略（当前 client checkout）

> 英文版：testing-strategy.md
> 说明：中文文档为准。

本文只记录当前 `client` 仓库 checkout 里真实存在的验证层。

## 1. 目标

让当前本地优先主路径在三层上都可验证：

- 逻辑与组件行为
- client 仓内各服务之间的集成行为
- 第四仓对固定 SHA 组合的跨仓认证

## 2. 当前验证分层

- `Unit`：逻辑、schema 处理、运行时工具、UI 组件行为
- `Integration`：`ops`、caller、responder、caller-skill adapter、MCP adapter、transport adapter 的真实 HTTP / 运行时测试
- `Package checks`：client 包的发布 / 安装形态校验
- `Workspace certification`：第四仓顶层对子模块、边界、contracts、source integration 的认证

## 3. 当前 checkout 真实存在的入口

`repos/client/package.json` 里当前可运行的命令是：

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:packages
```

当前 checkout 里真实存在的测试目录：

- `tests/unit`
- `tests/integration`
- `tests/helpers`
- `tests/config`

## 4. 当前 checkout 不存在的层

下面这些历史层或规划层在当前 checkout 里并不存在，不应再被当作可运行真相：

- `tests/e2e`
- `tests/mocks`
- `tests/reports/latest.json`
- `npm run test:e2e`
- `npm run test:compose-smoke`
- `npm run test:public-stack-smoke`
- `npm run test:local-images-smoke`
- `npm run test:published-images-smoke`

如果这些层未来回归，应当和对应实现文件、`package.json` 脚本一起被重新记录。

## 5. 跨仓认证路径

当前跨仓兼容性认证从第四仓工作区根目录执行：

```bash
corepack pnpm run check:submodules
corepack pnpm run check:boundaries
corepack pnpm run check:bundles
corepack pnpm run test:contracts
corepack pnpm run test:integration
```

当你要声明固定 `protocol + client + platform` SHA 组合兼容时，应以这条路径为准。

## 6. 本地冒烟与调试反馈面

如果要做当前产品主路径的本机可用性验证，请使用全新的 `DELEXEC_HOME` 并运行：

```bash
node apps/ops/src/cli.js bootstrap --email you@example.com
node apps/ops/src/cli.js status
node apps/ops/src/cli.js ui start --no-browser
```

当前最主要的运行态反馈面是：

- `delexec-ops status`
- `delexec-ops doctor`
- `delexec-ops debug-snapshot`
- `DELEXEC_HOME/logs/supervisor.events.jsonl`
- `DELEXEC_HOME/logs/` 下的各服务日志
