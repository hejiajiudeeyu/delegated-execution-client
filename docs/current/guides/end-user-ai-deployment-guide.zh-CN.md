# 终端用户 AI 部署指南

> 英文版：end-user-ai-deployment-guide.md
> 说明：中文文档为准。

本指南描述当前**受支持**的路径：让 AI 协助终端用户安装并启动本地客户端。

## 当前产品边界

当前 `client` 仓库已经支持：

- 本地 caller 初始化
- 本地 responder 启用
- 本地 hotline draft 管理
- 本地 hotline 发现
- 本地示例自调用

以下能力**还不是当前主路径**，应视为后续能力：

- 发布到 platform
- 发布到社区 catalog
- 把运维审批当作首次使用前提

当前本地优先路径请先看：[本地模式上手指南](./local-mode-onboarding.zh-CN.md)

## 当前受支持的安装策略

面向用户的受支持安装路径是已发布的 CLI 包：

```bash
npm install -g @delexec/ops
```

## AI 应该做什么

推荐的 AI 流程：

1. 安装 `@delexec/ops`
2. 完成本地初始化与解锁
3. 注册 caller
4. 启用本地 responder runtime
5. 安装官方示例 hotline
6. 检查生成的本地 draft
7. 执行本地示例自调用

## 推荐的本地优先命令

```bash
delexec-ops setup
delexec-ops auth login
delexec-ops auth register --email you@example.com
delexec-ops enable-responder
delexec-ops add-example-hotline
delexec-ops run-example --text "Summarize this request."
```

## 预期结果

AI 应确认以下本地模式结果：

- 本地 setup 是否完成
- caller 注册是否完成
- 本地 responder 是否已启用
- 示例 hotline 是否已添加
- hotline draft 是否已生成
- 示例请求是否成功

## 常用后续命令

```bash
delexec-ops run-example --text "Summarize this request."
delexec-ops doctor
delexec-ops debug-snapshot
```

## 当前限制

- 本指南只覆盖本地管理闭环
- platform / 社区发布仍是后续能力
- email transport 为可选项，不是本地优先路径的前提
