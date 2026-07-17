# FOUNDRY_EXECUTION_ENVELOPE

**Module:** `lib/foundry/envelope.ts` · **Status:** REAL

The canonical, validated input boundary for a governed execution or release.
Intake is side-effect-free and fail-closed — it NEVER executes.

## Envelope fields (`ExecutionEnvelopeSchema`, Zod)

`envelopeId`, `missionId?`, `projectRef`, `requestedOperation`
(`deploy|provision|configure|release|rollback|verify`), `targetEnvironment`
(`development|test|preview|staging|production`), `writeBoundary[]`,
`approvalRequirements[]` (`{stepId, reason}`), `idempotencyKey`, `evidenceRequired`,
`verificationRequired`, `rollbackRequired`, `retryPolicy` (`maxRetries`, `timeoutMs`),
`source` (`{orchestrator, reference?}`), `expiresAt?`, and the embedded `plan`
(the existing `DraftPlanSchema`).

## Validation performed

- Structural (Zod) — unparseable → `REJECTED`.
- Expiry — a stale envelope → `REJECTED`.
- Plan validation — delegates to `validateDraftPlan` (provider/action/budget/cycles/
  secret-reference rule).
- Forbidden-command scan — shell/command-injection patterns in any step config → `REJECTED`.
- Literal-secret block — credential-shaped config keys must be `secret:` references → `BLOCKED`.
- Replay/duplicate — a seen `idempotencyKey` → `BLOCKED`.
- Routing + risk — per step, resolves the execution mode and raises human gates for
  high/critical-risk or declared-approval steps.

## Decisions

| Decision | Meaning |
|----------|---------|
| `ACCEPTED` | Valid; no gates; safe for automatic execution. |
| `ACCEPTED_WITH_GATES` | Valid; will pause for the listed human gates. |
| `BLOCKED` | Structurally valid but policy denies (replay, literal secret, non-executable mode). |
| `REJECTED` | Invalid / expired / forbidden. Never executed. |

The result carries `gates[]`, `routing[]` (per-step mode decisions), `rejections[]`,
`blocks[]`, and `reasons[]`. Covered by 7 tests in `tests/operations.test.ts`.
