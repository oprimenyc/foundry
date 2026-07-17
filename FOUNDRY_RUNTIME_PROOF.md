# FOUNDRY_RUNTIME_PROOF

**Status:** PASS

Runtime is the proof. Commands run this mission, with results:

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | PASS |
| `node --test tests/**/*.test.ts` | 91 pass / 0 fail |
| `npx next build` | PASS |
| `npm run proof:release` | PASS (11/11 lifecycle stages) |
| Secret scan of new source | clean |

## What runtime proved (not asserted)

- Envelope intake returns real ACCEPTED/GATES/BLOCKED/REJECTED decisions.
- A run genuinely pauses at a human gate (`awaiting_approval`), a persisted gate is raised,
  and the run resumes to completion on approval / fails on rejection.
- Provider routing modes are chosen explicitly and non-executable modes fail loudly.
- Artifacts are retained, checksummed, and integrity-verified; tampering is detected.
- Release policy decisions are deterministic and fail-closed on unknown signals.
- Rollback compensates real (mock) provider actions in reverse.
- A simulated restart preserves terminal state with no double-mutation.

## Machine-readable evidence

`proof/evidence/governed-release-proof.json`.

---

## Live cross-runtime proof (2026-07-17 amendment)

Observed against the live Foundry service (`http://127.0.0.1:4319`, and `:4322` under the one-command harness):

| Surface | Result |
|---|---|
| `GET /api/healthz` | 200 `{status:ok, persistence:file, production_safe_persistence:true, auth:open-dev}` |
| `POST /api/projects` → `/plan` (draftPlan) → `/runs` | real project/validated-plan/executing run (no AI planner) |
| `GET /api/projects/[id]/runs/[runId]` | `run.status=completed`; `evidenceManifests[0]` = **RSASSA-PSS-SHA256**, signer `foundry-eve-proof-rsa` v1, real `manifestHash` + `rsa-pss-sha256:` signature |
| VERIDIAN `/api/factory/live-mission` | E.V.E. independent verdict **PASS** over the signed evidence |
| Foundry stopped → VERIDIAN live-mission | 503 `FOUNDRY_UNAVAILABLE` (`fetch failed`) — fail closed |

Cross-runtime artifacts live in the VERIDIAN repo: `artifacts/factory-proof/<UTC>-<nonce>/`
and `artifacts/eve-proofs/live-mission.json`. See `FOUNDRY_MISSION_EXECUTION.md`,
`FOUNDRY_SIGNING_AUTHORITY.md`, and VERIDIAN `FACTORY_RUNTIME_PROOF.md`.
