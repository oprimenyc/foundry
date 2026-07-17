# FOUNDRY_EXECUTION_STATE_MACHINE

**Modules:** `lib/foundry/execution.ts`, `lib/foundry/types.ts` · **Status:** VERIFIED

## States (`RunStatus`)

`queued → running → (awaiting_approval ↔ running) → completed`
with failure branches `failed`, `cancelled`, and rollback branches
`rolling_back → rolled_back`.

`awaiting_approval` is added by this mission for governed human gates.

## Transition rules

- All transitions persist through `updateRun` to the durable store (file/sqlite).
- **Pause:** at a gated step, the run moves to `awaiting_approval` and a
  `SagaPauseSignal` halts the saga *without* compensating completed steps.
- **Resume:** `resumeRunAfterGate` only acts on `awaiting_approval` runs, sets `running`,
  and re-enters `executeRun`, which **skips completed steps** (idempotent resume) and
  re-evaluates the gate at the exact paused step.
- **Restart recovery:** `resumeIncompleteRuns` resumes `queued/running/rolling_back` on
  boot; `awaiting_approval` deliberately stays paused until a human decides.
- **No duplicate provider mutation:** completed steps are skipped on resume; an in-process
  `__foundryActiveRuns` guard prevents concurrent double-execution.
- Every terminal/failed state records `failureCategory`, a redacted reason, timestamps,
  actor (`requestedBy`), and evidence references.

## Evidence

- Restart-resume tested in `tests/foundry.test.ts`.
- Pause/resume + reject tested in `tests/operations.test.ts` ("run pauses at an
  approvalRequired step…", "run fails when a human rejects the gate").
- Full lifecycle incl. restart reconciliation: `scripts/governed-release-proof.ts` stage 11.
