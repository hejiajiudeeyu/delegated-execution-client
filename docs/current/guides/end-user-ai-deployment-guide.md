# End-User AI Deployment Guide

This guide describes the **current supported** path for letting an AI help an end user install and bootstrap the local client.

## Current Product Boundary

The current `client` repository is ready for:

- local caller setup
- local responder enablement
- local hotline draft management
- local hotline discovery
- local example self-call

The following are **not** the current primary product path and should be treated as later work:

- platform publishing
- community catalog exposure
- operator review as a first-use requirement

For the current local-first path, start with [Local Mode Onboarding](./local-mode-onboarding.md).

## Current Supported Install Strategy

The supported user-facing install path is the published CLI package:

```bash
npm install -g @delexec/ops
```

## What The AI Should Do

The recommended AI flow is:

1. install `@delexec/ops`
2. initialize local setup and unlock
3. register the caller
4. enable the local responder runtime
5. install the official example hotline
6. inspect the generated local draft
7. run the local example self-call

## Recommended Local-First Commands

```bash
delexec-ops setup
delexec-ops auth login
delexec-ops auth register --email you@example.com
delexec-ops enable-responder
delexec-ops add-example-hotline
delexec-ops run-example --text "Summarize this request."
```

## Expected Outcomes

The AI should verify these local-mode outcomes:

- local setup completed or not
- caller registration completed or not
- local responder enabled or not
- example hotline added or not
- hotline draft generated or not
- example request succeeded or not

## Useful Follow-Up Commands

```bash
delexec-ops run-example --text "Summarize this request."
delexec-ops doctor
delexec-ops debug-snapshot
```

## Current Limits

- this guide covers local management only
- platform/community publishing remains a later workflow
- email transport is optional and not required for the local-first path
