# CLAUDE.md

## Project

oficina-billing-service: NestJS 11 + Prisma 7 (adapter-pg) + PostgreSQL.
Node 24.13.1, yarn 1.22.22, jest 30.

Responsible for budgets (orçamentos), charges (cobranças) and a simulated
payment gateway. It is part of a saga orchestrated by oficina-os-service via
SNS/SQS, using a transactional outbox and idempotency by `eventId`.

## Conventions

- Routes live under the global prefix `/billing`.
- The simulated gateway lives under `/gateway` (excluded from the prefix).
- Health: `/billing/health`. Swagger: `/billing/docs`.
- Commands:
  - `yarn lint`
  - `yarn build`
  - `yarn test:cov` (coverage threshold: 80%)
- Migrations run via a Kubernetes Job, never in the container entrypoint.
- Commit messages follow Conventional Commits, in English.
- Never commit to `main`.
- Never add AI attribution (no `Co-Authored-By: Claude`, no "Generated with
  Claude Code", no mention of Claude) in commits, branches, PRs or comments.

## Git conventions

- PR granularity: task.
- Branch name: `{type}/{phase}-{slug}`.
- PR title: `{type}: {summary}`.
- Plan files: local only, never committed.
