# FOUNDRY_POST_DEPLOYMENT_VERIFICATION

**Modules:** `lib/foundry/execution.ts` (`verifyRun`), `lib/foundry/verification.ts` · **Status:** REAL

Two independent layers:

1. **In-run launch verification** (`verifyRun`) — derives the references a run MUST have
   from the CATEGORIES its plan exercised (never vendor names), checks completeness, and
   emits a `LaunchEvidenceRecord` (`passed`/`failed`).
2. **Independent verifier** (`verifyRunIndependently`) — real HTTP GET against recorded
   `deploymentUrl`/`repoUrl`, appending `VerificationRecord`s. It **never mutates** runs,
   steps, or events, so an external verifier can disagree with a run's own success claim
   and both remain visible. `fetchImpl` is injectable; re-runs append new attempts.

## Outcomes

`passed` / `failed` per target; consumers read the latest per target and can see staleness
via `checkedAt`. Exposed via `POST /api/projects/:id/runs/:runId/verify`.

## Boundary

Auth probe, route smoke test, webhook handshake, and tenant-isolation checks are available
as verification targets but are only exercised against real URLs when a live deployment
exists. The E.V.E. boundary consumes/produces these records; a live E.V.E. request path is
integrated where the existing boundary allows. Tested in `tests/foundry.test.ts` and the
end-to-end proof (stage 7).
