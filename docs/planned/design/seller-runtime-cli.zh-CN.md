# Seller Runtime CLI 架构

> 英文版：seller-runtime-cli.md
> 说明：中文文档为准。

## 目标

让本地编码代理和终端用户可以在个人电脑上低成本安装并配置 seller 侧。

目标流程：

1. 用户让 Codex、Claude Code 或其他 coding agent 安装 seller 侧。
2. 工具执行一组稳定的 `npx` 命令。
3. 本地 seller runtime 完成配置、提交平台审核，并可托管一个或多个 subagent。

本架构不把 Codex 或 Claude Code 视为 subagent，它们是安装操作者。

## 非目标

- L0 阶段桌面安装器
- 面向终端用户的 Docker-first seller 安装路径
- 仅 hook 的集成模型
- seller onboarding 的复杂多租户管理流程

## 选定方向

- 以 `npx` / npm 作为主要安装与配置入口
- 本地 seller runtime 进程
- 基于 adapter 的 subagent 注册
- `process` 作为默认集成模型
- `http` 作为次选集成模型

## 为什么不是 Hook-Only

当前协议模型下，hook-only 过薄：seller 需要队列、签名、ACK、心跳、重试与状态管理；subagent 也需要稳定请求/响应契约。  
本地 coding agent 通过显式 CLI 命令比 ad-hoc hook 脚本更可靠。

## 当前用户侧 CLI

当前用户侧包：

- `@delexec/ops`

当前主路径命令：

```bash
npx @delexec/ops setup
npx @delexec/ops auth register
npx @delexec/ops add-subagent
npx @delexec/ops submit-review
npx @delexec/ops enable-seller
npx @delexec/ops start
npx @delexec/ops status
npx @delexec/ops doctor
npx @delexec/ops debug-snapshot
```

兼容别名仍为部分历史 `seller ...` 子命令保留，但不再是文档主路径。

### 命令职责（摘要）

- `setup`：初始化本地配置、签名密钥与默认 seller 身份
- `enable-seller`：仅启用本地 seller runtime
- `submit-review`：提交 seller/subagent 审核并持久化 seller API key
- `start`：启动本地 supervisor，并自动管理 relay/buyer/seller
- `status`：输出身份、进程健康、心跳、subagent 与审核状态
- `add-subagent`：注册本地 subagent 定义并校验 adapter，不自动提交审核
- `doctor`：验证本地配置、transport、platform 连通性与 adapter 目标

## 本地配置模型

统一 ops 客户端使用稳定本地配置，不依赖临时 env-only 方案。

推荐文件：

- `~/.delexec/.env.local`
- `~/.delexec/ops.config.json`

`.env.local` 用于简单运行时键值；`ops.config.json` 持有结构化 buyer/seller/runtime/adapter 配置。

## Adapter 模型

### 1. Process Adapter（默认推荐）

适用场景：本地脚本、Python/Node 程序、本地 coding-agent wrapper、workflow runner、命令行工具。

```bash
npx @delexec/ops add-subagent \
  --type process \
  --subagent-id local.summary.v1 \
  --display-name "Local Summary Agent" \
  --cmd "python3 /Users/me/agents/summary_agent.py" \
  --task-type summarize \
  --capability text.summarize
```

运行契约：

- runtime 向 stdin 发送单个 JSON
- 子进程在 stdout 返回单个 JSON
- stderr 作为诊断日志
- 非零退出码映射为 seller 执行错误

### 2. HTTP Adapter

当本地能力已是服务时使用：

```bash
npx @delexec/ops add-subagent \
  --type http \
  --subagent-id local.extractor.v1 \
  --display-name "Local Extractor API" \
  --url http://127.0.0.1:9001/invoke \
  --task-type extract \
  --capability field.extract
```

### 3. Function Adapter

保留给内部演示与测试，不作为主用户路径。

## `add-subagent` 行为

`add-subagent` 应作为本地 adapter 注册器，而非仅平台目录写入器：

1. 校验输入参数或配置文件
2. 写入 `ops.config.json`
3. 必要时更新运行时配置
4. 通过 `submit-review` 显式完成后续审核步骤
5. 重启或 reload 后可加载新 subagent

## 输入模式

支持：

1. 交互模式
2. 声明式模式

```bash
npx @delexec/ops add-subagent
npx @delexec/ops add-subagent --config ./subagent.json
```

声明式模式对 coding-agent 安装流程尤其重要。

## 运行时加载模型

当前实现已支持：

- seller 身份绑定多个 `subagent_ids`
- 后台心跳
- 后台 inbox polling
- 按 `subagent_id` 路由任务
- 状态接口暴露 subagent 与 adapter 摘要

## 剩余差距

当前主要是产品深度差距，而非架构差距：

1. subagent 编辑器更强字段校验与恢复提示
2. 超越当前 DOM/view-model 的更丰富浏览器工作流覆盖
3. adapter 性能和失败率的更强可观测性
4. buyer 侧 seller 发现的更丰富检索/排序

## 当前代码触点

- `apps/ops/src/cli.js`
- `apps/ops/src/supervisor.js`
- `apps/seller-controller/src/server.js`
- `packages/seller-runtime-core/src/index.js`
- `packages/seller-runtime-core/src/executors.js`
- `apps/ops-console/src/main.js`
- `deploy/ops/README.md`
- `README.md`
