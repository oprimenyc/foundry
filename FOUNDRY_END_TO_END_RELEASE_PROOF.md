# FOUNDRY_END_TO_END_RELEASE_PROOF

**Script:** `scripts/governed-release-proof.ts` (`npm run proof:release`) · **Status:** PASS

Exercises the full governed release lifecycle on a SAFE local fixture. **No production was
mutated**; provider writes use mock adapters; independent verification uses a stubbed
reachable target. Emits `proof/evidence/governed-release-proof.json`.

## Stages proven (11/11 PASS)

1. Envelope accepted → `ACCEPTED_WITH_GATES` (1 gate).
2. Policy evaluated pre-execution → `PROMOTION_BLOCKED` (unknown signals fail closed).
3. Plan validated.
4. Human gate raised → run paused at exact step (`awaiting_approval`).
5. Gate approved → resume → operation executed to completion; provider refs recorded.
6. Artifacts retained (`RELEASE` + `AUDIT`) and checksum-verified.
7. Independent verification passed (never mutates run history).
8. Signed evidence manifest present (HMAC-SHA256, 7 evidence items).
9. Post-execution promotion decision recorded (`PROMOTION_ALLOWED`).
10. Rollback executed via saga compensation → `rolled_back`.
11. Restart/reconciliation → terminal state preserved, no double-mutation.

## Honesty statement

This proves a **governed release lifecycle**, not a production release. Browser execution,
live production deployment, and live vault backends are out of scope and are reported as
boundaries (see `FOUNDRY_PROVIDER_ROUTING.md`, `FOUNDRY_IMPLEMENTATION_REPORT_PRODUCTION_OPERATIONS.md`).
