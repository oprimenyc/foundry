# FOUNDRY_EMAIL_QA_TEST_REPORT.md

## Suite

`tests/email-qa.test.ts` — 11 tests, run via `npm test` (`node --import tsx --test tests/**/*.test.ts`).

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | valid local email passes | PASS | `verdict === "PASS"`, evidence + inbox message produced |
| 2 | missing sender fails | PASS | `SENDER_MISMATCH` + `SENDER_DOMAIN_NOT_ALLOWED`, verdict `FAIL` |
| 3 | missing sender on a release-blocking email type is BLOCKED, not FAIL | PASS | same defect, `password_reset` type → verdict `BLOCKED` |
| 4 | unresolved placeholder fails | PASS | `{{customerFirstName}}`-style placeholder detected, verdict `FAIL` |
| 5 | wrong reply-to fails | PASS | `REPLY_TO_MISMATCH`, verdict reflects error |
| 6 | missing required link fails | PASS | footer link absent from body, `MISSING_REQUIRED_LINK` (error) |
| 7 | missing asset warns when criticality allows it, fails when it doesn't | PASS | same missing asset → `PASS_WITH_WARNINGS` under `missingAssetSeverity: "warning"`, `FAIL` under `"error"` |
| 8 | virtual inbox stores message | PASS | `listInboxMessages` returns the stored message with matching id/subject/type |
| 9 | evidence package is generated with dispatch via local fixture adapter | PASS | hashes present, `deliveryCorrelation.mode === "fixture"`, `simulated === true` |
| 10 | Resend adapter does not call real provider by default | PASS | three sub-cases: no gates, `allowLiveSend` alone, both gates — real client method only invoked when both gates set |
| 11 | product config validates | PASS | valid config passes, malformed config rejected with `CONFIG_SCHEMA_INVALID` issues, dyln sample config parses cleanly |

**Result: 11/11 new tests pass.**

## Full repo suite

`npm test` ran the entire existing suite plus the new file: **102/102 pass**
on the verifying run. (One run mid-session showed 101/102 with a transient
failure in a pre-existing, unrelated test; a clean rerun immediately after —
with no code changes — passed 102/102, confirming pre-existing flakiness
unrelated to this change, not a regression it introduced.)

## Typecheck

`npm run typecheck` (`tsc --noEmit`) — clean, 0 errors, after two fixes:
- `lib/email-qa/validate.ts`: replaced a `for...of` over `String.matchAll()`
  (requires `--downlevelIteration` under this repo's implicit ES3 target)
  with `Array.from(...).forEach(...)`.
- `tests/email-qa.test.ts`: replaced a `ConstructorParameters<...>` type
  extraction that didn't resolve cleanly with a direct `ResendQaAdapterOptions["client"]` reference.

## Build

`npm run build` (`next build`) — compiled successfully, typechecked, and
generated all static/dynamic routes with no errors or new warnings.

## Proof script

`npm run proof:email-qa` — all 6 steps PASS (sample config validates, a valid
email passes through the local fixture adapter, a broken release-blocking
email is correctly `BLOCKED`, the virtual inbox stores both messages, and the
Resend boundary is proven to skip the real call by default and only invoke it
once both explicit gates are set). Evidence bundle written to
`proof/evidence/email-qa-proof.json`.

## Secret scan

`detect-secrets scan` (Python `detect-secrets`, already present on this
machine — no dedicated secret-scan npm script exists in this repo) against
every new file (`lib/email-qa/**`, `tests/email-qa.test.ts`,
`scripts/email-qa-proof.ts`, and this mission's markdown docs):
`"results": {}` — zero findings.
