# 客户端发布边界

> 英文版：release-surface.md
> 说明：中文文档为准。

本仓库面向用户的主要客户端包只有一个：

- `@delexec/ops`

## 主产品表面

普通用户应通过以下方式与本仓库交互：

- `npm install -g @delexec/ops`
- `npx @delexec/ops`
- `delexec-ops ...`

## 内部支撑包

本仓库仍包含如下支撑包：

- `@delexec/runtime-utils`
- `@delexec/sqlite-store`
- `@delexec/caller-controller-core`
- `@delexec/responder-runtime-core`
- `@delexec/transport-*`

这些包存在的目的：

- 仓库内本地开发
- clean-room 包校验
- 拆分过渡期的跨仓依赖

它们不是主要产品表面，不应作为普通用户安装路径。

## 发布策略

1. 涉及协议变更时，先发布 `@delexec/contracts`。
2. 仅在其他仓库仍需要时发布支撑包。
3. 将 `@delexec/ops` 作为面向终端用户的主客户端产物发布。

## 开发规则

在决定 UX 和文档投入位置时，应优化 `delexec-ops` 体验，而不是优化手动拼装内部包的路径。
