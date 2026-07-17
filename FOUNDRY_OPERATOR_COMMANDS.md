# FOUNDRY_OPERATOR_COMMANDS

**Status:** REAL (API + scripts) / no CLI binary

## API surface (auth-gated, org-scoped)

| Intent | Route |
|--------|-------|
| doctor / health | `GET /api/healthz` |
| providers list/status | `GET /api/providers`, `GET /api/ops` |
| executions plan | `POST /api/projects/:id/plan` |
| executions run | `POST /api/projects/:id/runs` |
| executions status | `GET /api/projects/:id/runs/:runId` |
| executions logs (stream) | `GET /api/projects/:id/runs/:runId/logs` (SSE) |
| approvals list | `GET /api/projects/:id/runs/:runId/approvals` |
| approvals approve/reject/defer (+resume) | `POST /api/projects/:id/runs/:runId/approvals` |
| verify | `POST /api/projects/:id/runs/:runId/verify` |
| rollback | `POST /api/projects/:id/runs/:runId/rollback` |
| cancel | `POST /api/projects/:id/runs/:runId/cancel` |
| ops report / incidents | `GET`/`POST /api/ops` |

## Scripts (proofs / dry-runs)

`npm run proof:mock | proof:github | proof:m2 | proof:m4 | proof:release`, `npm run smoke`.
All emit JSON or human-readable output with meaningful exit codes and no secret output.

## Gap (honest)

A single `foundry` CLI binary aggregating `providers/executions/approvals/artifacts/
releases/evidence` subcommands is not built; the equivalent operations exist as API routes
+ library functions + proof scripts. A thin CLI wrapper over these is a straightforward
next step.
