# @delexec/ops

Unified operator CLI for delegated execution clients.

## Paid Hotline Drafts

Responder operators can declare a fixed-price Hotline while creating the local registration draft:

```bash
delexec-ops responder add-hotline \
  --type process \
  --hotline-id opc.summary.v1 \
  --cmd "node worker.js" \
  --fixed-price-cents 50 \
  --currency PTS \
  --billing-disclosure-url "https://callanything.xyz/marketplace/responders/opc-summary"
```

The generated draft keeps the `pricing_hint`, and `delexec-ops submit-review` submits it to the connected platform catalog.
