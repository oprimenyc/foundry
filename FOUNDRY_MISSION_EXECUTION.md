# Foundry Mission Execution

**Status:** VERIFIED — genuine execution, not an echo.

## The proof mission

A bounded, deterministic provisioning mission using labeled mock providers (no
paid APIs, no PrimeOS): create GitHub repository → verify repository. It exercises
the real executor, saga orchestration, persistence, evidence, and signing.

## What actually happens (`lib/foundry/execution.ts`)

1. `POST /api/projects` persists a draft project + seeds mock credentials.
2. `POST /api/projects/[id]/plan` with a `draftPlan` → `validateDraftPlan` → status `validated` (no AI planner needed).
3. `POST /api/projects/[id]/runs` → inserts a `queued` run, dedupes on `(projectId, idempotencyKey)`, then `startRunExecution`.
4. `executeRun` runs each step through a `SagaOrchestrator`: cancellation check → human/vault gates → routing (`resolveExecutionMode`, fails closed if not executable) → `adapter.execute` with timeout + retry → records provider references, events, rollback metadata.
5. On success: builds launch evidence, computes evidence-item checksums, **issues the RSA-PSS signed manifest** (`issueSignedEvidenceManifest`), persists it to `evidenceManifests`, marks the run `completed` (progress 100).
6. `GET /api/projects/[id]/runs/[runId]` returns `{run, steps, evidence, evidenceManifests, verifications}`.

## Real, inspectable output

- Provider references (e.g. `githubRepoUrl`) derived deterministically from content.
- `evidenceItems[].hash` are real `sha256:` checksums of the evidence content.
- Idempotent resubmission returns the same run; incompatible duplicate is rejected.
- Restart mid/after run reconciles via `resumeIncompleteRuns()`.

## Observed (runtime proof)

Live run `run_e33ebbd3-…` (and others) reached `status=completed` and produced
`evidenceManifests[0]` with `signatureAlgorithm=RSASSA-PSS-SHA256`,
`signerKeyId=foundry-eve-proof-rsa`, a real `manifestHash` and `rsa-pss-sha256:` signature.
See `FOUNDRY_RUNTIME_PROOF.md` and VERIDIAN `artifacts/factory-proof/<ts>/`.

## Not used (unacceptable substitutes explicitly avoided)

No echoing of the request, no hardcoded PASS, no in-memory-only completion, no
direct DB insertion of a completed mission, no signing without executing, no
in-process VERIDIAN→Foundry shortcut, no mock HTTP server standing in for Foundry,
no post-signing edit, and E.V.E. never received the private key.
