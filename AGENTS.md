# AGENTS.md

Agent instructions for this repository:

- Primary responsibility: end-user client runtime and `delexec-ops`.
- Primary public artifact: `@delexec/ops`.
- Treat buyer/seller cores, storage, and transport packages as support layers unless a task explicitly targets them.
- Route protocol-shape changes to `delegated-execution-protocol`.
- Route operator deployment and image changes to `delegated-execution-platform-selfhost`.

Minimum local validation:

```bash
npm test
npm run test:packages
```
