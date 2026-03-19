# OpenClaw 适配指南

> 英文版：openclaw-adapter.md
> 说明：中文文档为准。

状态：Draft  
更新时间：2026-03-07

本文档说明如何把 Buyer 侧的 `Remote Subagent Protocol` 能力适配成 OpenClaw 可直接使用的 skill。

## 1. 适配目标

对 OpenClaw 而言，理想做法是让它看到稳定、少量的 skill，协议编排由 Buyer 侧桥接服务负责，返回结构化结果，而不是暴露 token、ACK、验签等细节。

## 2. 为什么需要桥接层

OpenClaw 的 skill 接入天然更适合“高层能力接口”，不适合直接调用 Buyer Controller 的多步接口。  
若直接暴露底层接口，模型将被迫承担 `request_id` 管理、重试超时、签名验收等不应由模型承担的职责。

## 3. 推荐适配形态

### 3.1 一个通用 skill

优先推荐：`remote-subagent`  
不建议一开始按具体卖家或子能力暴露大量离散 skill 名称。

### 3.2 在 skill 内部支持 alias

可在桥接层内部维护 alias（如 `classify-text -> foxlab.text.classifier.v1`），但 alias 不应替代协议真相层里的 `subagent_id`。

## 4. OpenClaw 配置建议

在 `~/.openclaw/openclaw.json` 中加入：

```json
{
  "skills": {
    "remote-subagent": {
      "baseUrl": "http://127.0.0.1:8090/skills/remote-subagent",
      "apiKey": "buyer_你的Buyer或桥接层Key"
    }
  }
}
```

## 5. 推荐桥接接口

- `GET /skills/remote-subagent/catalog`
- `POST /skills/remote-subagent/invoke`
- `GET /skills/remote-subagent/requests/{requestId}`

## 6. 与当前仓库的映射

桥接层可基于 Buyer Controller 现有能力实现，并在内部固定 `catalog -> request -> prepare -> dispatch -> sync-events/inbox-pull -> request查询` 路径，最终映射为稳定 skill 返回。

## 7. Prompt / Skill 使用建议

- 需要远程能力时优先使用 `remote-subagent`
- 不要手工拼 Buyer Controller 多步 HTTP
- 不向最终用户暴露 token、delivery address、ACK 细节
- 返回结构化结果并附 `requestId` 便于追踪

## 8. 适配硬约束

- skill 返回字段保持稳定（`status`、`result`、`error`、`requestId`）
- 桥接层内部必须保留审计字段（`requestId`、`sellerId`、`subagentId`、`resultPackage`）
- skill 名称不要绑定 seller 身份

## 9. 当前边界

当前仓库具备适配所需协议底座，但尚未内置 OpenClaw bridge 服务。  
建议后续以独立目录落地，例如 `apps/openclaw-bridge`，而非把 OpenClaw 专有语义直接写入 Buyer Controller。
