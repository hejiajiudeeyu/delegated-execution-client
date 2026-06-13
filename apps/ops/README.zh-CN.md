# @delexec/ops

> 英文版：README.md
> 说明：中文文档为准。

面向委托执行客户端的统一运维 CLI。

## 付费 Hotline Draft

Responder operator 可以在创建本地 registration draft 时声明固定价格：

```bash
delexec-ops responder add-hotline \
  --type process \
  --hotline-id opc.summary.v1 \
  --cmd "node worker.js" \
  --fixed-price-cents 50 \
  --currency PTS \
  --billing-disclosure-url "https://callanything.xyz/marketplace/responders/opc-summary"
```

生成的 draft 会保留 `pricing_hint`，随后 `delexec-ops submit-review` 会把该价格信息提交到已连接的 platform catalog。
