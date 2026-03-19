# delegated-execution-client（中文）

> 英文版：README.md
> 说明：中文文档为准。

客户端运行时与 CLI，用于委托执行。

本仓库包含从原始单体仓库拆分后的客户端侧实现。

## AI 协作

- `CLAUDE.md` 定义仓库级开发与验证规则。
- `AGENTS.md` 提供面向 AI 编码代理的最小路由与归属说明。

## 对外产品边界

本仓库唯一面向终端用户的安装入口是：

- `@delexec/ops`

用户应通过 `delexec-ops` 安装或运行客户端，而不是手工拼装 buyer、seller、storage、transport 等内部包。

推荐的用户入口：

```bash
npm install -g @delexec/ops
delexec-ops bootstrap --email you@example.com --platform http://127.0.0.1:8080
```

## 仓库职责

本仓库负责终端用户客户端运行时：

- `@delexec/ops` 产品包与 `delexec-ops` CLI
- buyer 侧本地控制流与 seller 侧本地运行时管理
- 本地状态、密钥处理、基于 SQLite 的客户端存储与本地传输适配
- 客户端侧 onboarding、bootstrap、诊断与排障文档

本仓库不负责协议真相源定义，也不负责面向运维的自托管平台部署面。

## 当前状态

`@delexec/contracts` 已发布到 npm，因此本仓库可独立运行 CI 与 clean-room 包校验。

## 内部包

本仓库仍包含 buyer/seller 控制器、本地存储、传输适配器等内部实现包。它们因为 `@delexec/ops` 依赖而继续可测试、可发布，但不属于主要产品界面。

## 维护者说明

拆分过渡期间，本仓库的一些共享包仍会单独发布，因为其他仓库仍在依赖它们。

应将这些包视为实现支撑层，而非客户端主产品界面。

另见：`docs/current/guides/release-surface.md`  
另见：`docs/current/guides/source-integration-runbook.md`

## 在本仓库开发

- 当改动影响终端 CLI 流程、本地 buyer/seller 行为、本地持久化或客户端传输接线时，从这里开始。
- 保持产品边界：普通用户只应需要 `@delexec/ops`，而不是一组内部包。
- 共享内部包需维持足够稳定以支撑测试与打包，但文档与示例应优先优化 `delexec-ops` 路径。

推荐变更流程：

1. 若改动涉及协议语义，先更新 `delegated-execution-protocol` 并消费已发布的 `@delexec/contracts`。
2. 在本仓库实现客户端运行时与 CLI 改动。
3. 发布前执行仓库 CI 与包级检查。
4. 仅当其他仓库仍依赖时发布共享支撑包；否则发布 `@delexec/ops` 作为用户侧产物。
