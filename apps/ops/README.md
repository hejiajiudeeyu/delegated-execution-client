# @delexec/ops

Unified operator CLI for delegated execution clients.

## Paid Hotline Drafts

Responder operators can declare a fixed-price Hotline while creating the local registration draft:

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

The generated draft keeps the `pricing_hint`, and `delexec-ops submit-review` submits it to the connected platform catalog.

## Logical Service Calls

Multiple responders can publish different concrete Hotlines under the same logical service:

```bash
delexec-ops responder add-hotline \
  --type process \
  --hotline-id mineru.machine-a.parse.v1 \
  --service-id mineru.document.parse.v1 \
  --capability document.parse.pdf \
  --task-type document_parse \
  --cmd "node worker.js"
```

Callers can then let Platform choose the concrete responder and Hotline:

```bash
delexec-ops call-hotline \
  --platform https://platform.example.com \
  --service-id mineru.document.parse.v1 \
  --capability document.parse.pdf \
  --task-type document_parse \
  --text "Parse this PDF."
```

Use `--hotline-id` and `--responder-id` for direct concrete calls; use `--service-id` or `--capability` for Platform-side service resolution.
