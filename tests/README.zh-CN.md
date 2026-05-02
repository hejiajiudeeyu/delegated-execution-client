# 测试说明

> 英文版：README.md
> 说明：中文文档为准。

本目录只描述当前 `client` checkout 里真实存在、真实可运行的测试面。

## 目录

- `tests/unit`：纯逻辑与组件级测试
- `tests/integration`：本地客户端服务的 HTTP / 运行时集成测试
- `tests/helpers`：共享测试工具
- `tests/config`：Vitest 配置

当前集成覆盖包括：

- `ops` CLI 与 supervisor 流程
- caller controller 请求链路
- caller-skill adapter 与 MCP adapter
- responder controller 注册 / 运行时流程
- local、relay HTTP、EmailEngine、Gmail transport adapter

## 在 client 仓库内运行

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:packages
```

## 重要边界

当前 checkout **并没有** 以下旧测试层或脚本：

- `tests/e2e`
- `tests/mocks`
- `tests/reports/latest.json`
- `npm run test:e2e`
- `npm run test:compose-smoke`
- `npm run test:public-stack-smoke`
- `npm run test:local-images-smoke`
- `npm run test:published-images-smoke`

除非对应文件和 `package.json` 脚本在同一个 checkout 里被重新加回，否则不要把这些路径当作当前可用入口。

## 跨仓认证入口

当前固定 SHA 组合的跨仓兼容性验证在第四仓工作区根目录执行，不由这个 `client` 包单独承担：

```bash
corepack pnpm run check:submodules
corepack pnpm run check:boundaries
corepack pnpm run check:bundles
corepack pnpm run test:contracts
corepack pnpm run test:integration
```

## 本地运行态冒烟

如果要验证当前本地优先主路径，可直接在本仓库里运行源码 CLI：

```bash
node apps/ops/src/cli.js bootstrap --email you@example.com
node apps/ops/src/cli.js status
node apps/ops/src/cli.js ui start --no-browser
```

需要干净环境时，请使用隔离的 `DELEXEC_HOME`。
