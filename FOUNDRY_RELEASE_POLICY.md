# FOUNDRY_RELEASE_POLICY

**Module:** `lib/foundry/release-policy.ts` · **Status:** VERIFIED

Deterministic, explainable promotion decisions. A deployment **never** promotes merely
because a command exited zero.

## Inputs (`ReleaseContext`)

`targetEnvironment` (`test|preview|staging|production`), `riskLevel`, and signals
(`passed|failed|unknown`) for tests, build, runtime, security, independent verification,
provider health — plus `approvalsGranted`, `artifactsComplete`, `rollbackReady`,
`withinChangeWindow?`.

## Decision (`evaluatePromotion`)

| Outcome | When |
|---------|------|
| `PROMOTION_BLOCKED` | Any signal `failed`, rollback not ready, artifacts incomplete, or outside a declared-closed production change window. |
| `MANUAL_REVIEW_REQUIRED` | Any required signal `unknown`, critical risk, or required approvals not yet met. |
| `PROMOTION_ALLOWED_WITH_APPROVAL` | All gates green and required approvals recorded. |
| `PROMOTION_ALLOWED` | All gates green and no approvals required. |

## Fail-closed rules

- `unknown` is never treated as `passed` — it forces manual review.
- Critical risk always requires explicit human sign-off, even when every signal is green.
- Required approvals scale by environment × risk (production/critical = 2, production/other
  = 1, staging high/critical = 1, else 0).

Returns `{outcome, requiredApprovals, blockingReasons[], warnings[], reasons[]}`. Tested by
6 cases in `tests/operations.test.ts` and exercised in the end-to-end proof (stages 2 & 9).
