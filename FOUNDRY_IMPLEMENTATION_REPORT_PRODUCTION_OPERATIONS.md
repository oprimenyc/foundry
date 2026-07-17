# FOUNDRY — Production Operations + Governed Release Implementation Report

**Mission:** finish Foundry as the real governed execution runtime.
**Branch:** `mission/m3-vault-intelligence` · **Starting HEAD:** `9e2a33f`
**Scope:** Foundry repo only. No cross-repo writes. No production mutation.

## What was already real (verified, not assumed)

Foundry entered this mission far more complete than a greenfield. Verified REAL by
source reading + the passing baseline (68 tests, typecheck clean): persisted execution
state machine, saga rollback + compensation, crash-recovery/restart, signed evidence
manifests (HMAC/RSA-PSS/external-KMS), independent verification, 6 live HTTP provider
adapters (GitHub, Vercel, Cloudflare, Resend, Stripe, SignalWire), provider selection /
health / intelligence, AES-256-GCM KMS secret store, Prime Vault control plane
(references, redaction, trusted resolver, approvals/policy/leases), auth + cross-org
isolation, and the `/api/ops` operator report. Full detail: `FOUNDRY_CURRENT_RUNTIME_TRUTH.md`.

## What this mission added (all real, all tested)

| Area | Module | Status |
|------|--------|--------|
| Execution envelope intake | `lib/foundry/envelope.ts` | REAL — `ACCEPTED / ACCEPTED_WITH_GATES / BLOCKED / REJECTED` |
| Provider routing modes | `lib/foundry/routing.ts` | REAL — explicit `API/CLI/BROWSER/HUMAN/UNSUPPORTED`, no silent fallback |
| Human gate pause/resume | `lib/foundry/human-gates.ts` + `execution.ts` + `saga.ts` | REAL — persisted gates, `awaiting_approval` state, resume-at-exact-step |
| Artifact retention | `lib/foundry/artifacts.ts` | REAL — content-addressed, checksummed, retention classes, redacted, expiry |
| Release policy engine | `lib/foundry/release-policy.ts` | REAL — deterministic promotion decision |
| Operator surface | `app/api/projects/[id]/runs/[runId]/approvals/route.ts` | REAL — list/decide gates + resume |
| End-to-end proof | `scripts/governed-release-proof.ts` | REAL — 11-stage lifecycle, emits evidence bundle |

### The headline change: human gates are now wired into execution

Before, the vault approval subsystem existed but no run ever invoked it, and
`approvalRequired` steps were *rejected at validation*. Now:

1. Execution reaches a step that is `approvalRequired` or a high/critical-risk action.
2. A durable `ApprovalGateRecord` is raised, the run moves to `awaiting_approval`, and a
   `SagaPauseSignal` halts the saga **without** compensating completed steps.
3. A human approves/rejects/defers (API or `decideGate`).
4. On approval, `resumeRunAfterGate` re-enters execution, which skips completed steps and
   proceeds from the exact paused step. On rejection, the run fails and rolls back.

Because gates are persisted (not the in-memory vault approvals map), a pause **survives a
process restart** — a paused run stays paused until a human decides.

## Test + proof evidence

- `tests/operations.test.ts` — 23 new tests: envelope intake (accept/gates/block/reject),
  routing modes, release policy, artifact retention (checksum/tamper/redaction/expiry),
  and the gate pause→approve→complete and pause→reject→fail flows end-to-end.
- Full suite: **91/91 pass** (68 prior + 23 new). Typecheck clean. `next build` passes.
- `npm run proof:release` → 11/11 lifecycle stages PASS, evidence at
  `proof/evidence/governed-release-proof.json`.

## Honest boundaries (NOT claimed as done)

- **Real browser (Playwright) automation** — BOUNDARY_ONLY. Routing returns `BROWSER`
  with `executable: false` and an explicit "no driver provisioned" reason. Foundry never
  fakes a browser success.
- **Live production deployment/mutation** — NOT performed. No production was touched.
- **Live vault backends** (Infisical/OpenBao/AWS) — remain fail-closed scaffolds; not
  instantiated.
- **CLI binary** — operator surface is API + scripts; no `foundry` CLI binary was added.

## Constitution compliance

- **No silent failures** — artifact-retention failure at run completion is a *visible*
  degraded-mode event, not swallowed. Non-executable routing modes fail the step loudly.
- **Every mutation authorized** — gates + vault execution gate remain in the path.
- **No fake success** — browser/production/live-backend gaps are reported, not simulated.
- **No secrets in evidence** — artifacts are redacted before hashing and writing; the
  stored bytes and checksum are both over redacted content (tested).
