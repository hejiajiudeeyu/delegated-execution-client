# 编码代理上手指南

> 英文版：coding-agent-onboarding.md
> 说明：中文文档为准。

本仓库当前提供的是稳定的**本地优先**路径，供 coding agent 使用。

## 当前范围

当前 coding-agent onboarding 只覆盖：

- 本地初始化与解锁
- 本地 caller 注册
- 本地 responder 启用
- 本地 hotline draft 生成
- 本地 hotline 发现与自调用

platform 发布和社区能力仍属于后续工作，不是这里的主要上手目标。

## 推荐路径

请先使用本地模式指南：

- [本地模式上手指南](./local-mode-onboarding.zh-CN.md)
- [Agent 本地安装剧本](./agent-local-install-playbook.zh-CN.md)

推荐命令：

```bash
npm install -g @delexec/ops
delexec-ops setup
delexec-ops auth login
delexec-ops auth register --email coding-agent@local.test
delexec-ops enable-responder
delexec-ops add-example-hotline
delexec-ops run-example --text "Summarize this request."
```

## 成功判定

满足以下条件即表示本地路径完成：

- 本地 setup 成功
- caller 注册成功
- responder 已启用
- 示例 hotline 已安装
- 本地 draft 已生成
- 示例自调用到达 `SUCCEEDED`

## 常用后续命令

```bash
delexec-ops add-example-hotline
delexec-ops run-example --text "Summarize this request."
delexec-ops doctor
delexec-ops debug-snapshot
```

## 常用日志与快照

- 本地 ops 主目录：`~/.delexec`
- 运行时日志：`~/.delexec/logs`
- 调试快照：`GET http://127.0.0.1:8079/debug/snapshot`
- supervisor 状态：`GET http://127.0.0.1:8079/status`
