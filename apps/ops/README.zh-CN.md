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
  --service-id document.summary.v1 \
  --cmd "node worker.js" \
  --fixed-price-cents 50 \
  --currency PTS \
  --billing-disclosure-url "https://callanything.xyz/marketplace/responders/opc-summary"
```

生成的 draft 会保留 `pricing_hint`，随后 `delexec-ops submit-review` 会把该价格信息提交到已连接的 platform catalog。

## 逻辑服务调用

多个 responder 可以把不同的具体 Hotline 挂到同一个逻辑 service 下：

```bash
delexec-ops responder add-hotline \
  --type process \
  --hotline-id mineru.machine-a.parse.v1 \
  --service-id mineru.document.parse.v1 \
  --capability document.parse.pdf \
  --task-type document_parse \
  --cmd "node worker.js"
```

Caller 侧再让 Platform 选择具体 responder 和 Hotline：

```bash
delexec-ops call-hotline \
  --platform https://platform.example.com \
  --service-id mineru.document.parse.v1 \
  --capability document.parse.pdf \
  --task-type document_parse \
  --text "Parse this PDF."
```

具体直连时继续用 `--hotline-id` + `--responder-id`；需要平台侧 resolve 时用 `--service-id` 或 `--capability`。
