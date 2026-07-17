# FOUNDRY_HUMAN_GATE_FLOW

**Modules:** `lib/foundry/human-gates.ts`, `execution.ts`, `orchestration/saga.ts`,
`app/api/projects/[id]/runs/[runId]/approvals/route.ts` · **Status:** VERIFIED

Persistent human gates with pause + resume, surviving process restart.

## Flow

1. **Reach a gated step** — `evaluateGateRequirement` returns `required: true` when the
   step is `approvalRequired` or its action is high/critical risk.
2. **Pause** — a durable `ApprovalGateRecord` (`pending`, with `expiresAt`, `reason`,
   `requiredAction`) is inserted; the run moves to `awaiting_approval`; a `SagaPauseSignal`
   halts the saga *without* compensating completed steps; an event records the gate id and
   the required human action.
3. **Decide** — `decideGate(gateId, approved|rejected|deferred, decidedBy, {note})`.
   Only `pending`, unexpired gates can be decided; decided gates are immutable; expired
   gates flip to `expired` and cannot be approved.
4. **Resume** — on `approved`, `resumeRunAfterGate` re-enters execution from the exact
   paused step (completed steps skipped). On `rejected`, the run fails and rolls back.

## Persistence & restart

Gates live in the durable store (`approvalGates` collection), not the in-memory vault
approvals map — so a paused run stays paused across a restart. `resumeIncompleteRuns` does
**not** auto-resume `awaiting_approval` runs.

## Supported gate reasons

`approvalRequired` steps, and any high/critical-risk action (delete/destroy, DNS/domain/
certificate, billing/funds/payout, production-raised mutations). Interactive handoffs
(login, MFA, passkey, CAPTCHA, legal acceptance) are surfaced through routing `HUMAN`/
`BROWSER` modes as non-executable, requiring an out-of-band human step.

## Operator API

- `GET  /api/projects/:id/runs/:runId/approvals` → list gates.
- `POST /api/projects/:id/runs/:runId/approvals` `{gateId, decision, note?}` → decide +
  resume. Auth-gated and org-scoped; `409` on already-decided/expired gates.

Tested end-to-end (approve→complete, reject→fail) in `tests/operations.test.ts` and
`scripts/governed-release-proof.ts` (stages 4–5).
