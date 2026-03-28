# Responder Runtime CLI 架构

> 英文版：responder-runtime-cli.md
> 说明：中文文档为准。

## 目标

让本地编码代理和终端用户可以在个人电脑上低成本安装并配置 responder 侧。

目标流程：

1. 用户让 Codex、Claude Code 或其他 coding agent 安装 responder 侧。
2. 工具执行一组稳定的 `npx` 命令。
3. 本地 responder runtime 完成配置、提交平台审核，并可托管一个或多个 hotline。

本架构不把 Codex 或 Claude Code 视为 hotline，它们是安装操作者。

## 非目标

- L0 阶段桌面安装器
- 面向终端用户的 Docker-first responder 安装路径
- 仅 hook 的集成模型
- responder onboarding 的复杂多租户管理流程

## 选定方向

- 以 `npx` / npm 作为主要安装与配置入口
- 本地 responder runtime 进程
- 基于 adapter 的 hotline 注册
- `process` 作为默认集成模型
- `http` 作为次选集成模型

## 为什么不是 Hook-Only

当前协议模型下，hook-only 过薄：responder 需要队列、签名、ACK、心跳、重试与状态管理；hotline 也需要稳定请求/响应契约。  
本地 coding agent 通过显式 CLI 命令比 ad-hoc hook 脚本更可靠。

## 当前用户侧 CLI

当前用户侧包：

- `@delexec/ops`

当前主路径命令：

```bash
npx @delexec/ops setup
npx @delexec/ops auth register
npx @delexec/ops add-hotline
npx @delexec/ops submit-review
npx @delexec/ops enable-responder
npx @delexec/ops start
npx @delexec/ops status
npx @delexec/ops doctor
npx @delexec/ops debug-snapshot
```

兼容别名仍为部分历史 `responder ...` 子命令保留，但不再是文档主路径。

### 命令职责（摘要）

- `setup`：初始化本地配置、签名密钥与默认 responder 身份
- `enable-responder`：仅启用本地 responder runtime
- `submit-review`：提交 responder/hotline 审核并持久化 responder API key
- `start`：启动本地 supervisor，并自动管理 relay/caller/responder
- `status`：输出身份、进程健康、心跳、hotline 与审核状态
- `add-hotline`：注册本地 hotline 定义并校验 adapter，不自动提交审核
- `doctor`：验证本地配置、transport、platform 连通性与 adapter 目标

## 本地配置模型

统一 ops 客户端使用稳定本地配置，不依赖临时 env-only 方案。

推荐文件：

- `~/.delexec/.env.local`
- `~/.delexec/ops.config.json`

`.env.local` 用于简单运行时键值；`ops.config.json` 持有结构化 caller/responder/runtime/adapter 配置。

## Adapter 模型

### 1. Process Adapter（默认推荐）

适用场景：本地脚本、Python/Node 程序、本地 coding-agent wrapper、workflow runner、命令行工具。

```bash
npx @delexec/ops add-hotline \
  --type process \
  --hotline-id local.summary.v1 \
  --display-name "Local Summary Agent" \
  --cmd "python3 /Users/me/agents/summary_agent.py" \
  --task-type summarize \
  --capability text.summarize
```

运行契约：

- runtime 向 stdin 发送单个 JSON
- 子进程在 stdout 返回单个 JSON
- stderr 作为诊断日志
- 非零退出码映射为 responder 执行错误

### 2. HTTP Adapter

当本地能力已是服务时使用：

```bash
npx @delexec/ops add-hotline \
  --type http \
  --hotline-id local.extractor.v1 \
  --display-name "Local Extractor API" \
  --url http://127.0.0.1:9001/invoke \
  --task-type extract \
  --capability field.extract
```

### 3. Function Adapter

保留给内部演示与测试，不作为主用户路径。

## `add-hotline` 行为

`add-hotline` 应作为本地 adapter 注册器，而非仅平台目录写入器：

1. 校验输入参数或配置文件
2. 写入 `ops.config.json`
3. 必要时更新运行时配置
4. 通过 `submit-review` 显式完成后续审核步骤
5. 重启或 reload 后可加载新 hotline

## 输入模式

支持：

1. 交互模式
2. 声明式模式

```bash
npx @delexec/ops add-hotline
npx @delexec/ops add-hotline --config ./hotline.json
```

声明式模式对 coding-agent 安装流程尤其重要。

## 运行时加载模型

当前实现已支持：

- responder 身份绑定多个 `hotline_ids`
- 后台心跳
- 后台 inbox polling
- 按 `hotline_id` 路由任务
- 状态接口暴露 hotline 与 adapter 摘要

## 剩余差距

当前主要是产品深度差距，而非架构差距：

1. hotline 编辑器更强字段校验与恢复提示
2. 超越当前 DOM/view-model 的更丰富浏览器工作流覆盖
3. adapter 性能和失败率的更强可观测性
4. caller 侧 responder 发现的更丰富检索/排序

## 当前代码触点

- `apps/ops/src/cli.js`
- `apps/ops/src/supervisor.js`
- `apps/responder-controller/src/server.js`
- `packages/responder-runtime-core/src/index.js`
- `packages/responder-runtime-core/src/executors.js`
- `apps/ops-console/src/main.js`
- `deploy/ops/README.md`
- `README.md`
