# FOUNDRY_SECRET_REMEDIATION_TEST_REPORT.md

## Suite

`tests/secret-remediation.test.ts` — 13 tests, run via `npm test`
(`node --import tsx --test tests/**/*.test.ts`).

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | raw secret value is rejected outright, not merely redacted | PASS | a fake GitHub-PAT-shaped string, a `KEY=value` .env-line shape, and a URL-embedded-credential shape each throw `SecretExposureFindingValidationError`; a plain 40-char git commit SHA in `sourceReference` is confirmed **not** flagged (routine metadata, not a secret) |
| 2 | `secretFingerprint` must be a sha256 hash, never a raw value | PASS | `"not-a-hash"` rejected; `sha256:<64 hex>` accepted and round-trips through ingestion |
| 3 | GitHub PAT finding creates a rotation + revocation plan | PASS | `providerRotationSteps`/`revocationSteps` non-empty; gates include `live_provider_credential_rotation` and `credential_revocation` |
| 4 | historical DB URL finding creates rotation steps plus a history-rewrite decision gate | PASS | fixture's `historyRewriteRequired: "optional"` maps to `git_history_rewrite` + `force_push` + `deployment_env_mutation` gates |
| 5 | vITALCore tracked `.env` finding creates an untrack + rotation plan | PASS | plan contains a `git rm --cached .env` containment step plus rotation steps |
| 6 | Google OAuth secret finding requires `live_provider_credential_rotation` approval | PASS | plan gate present; the Google adapter's `requiredApproval` is exactly `["live_provider_credential_rotation"]` |
| 7 | NextAuth secret finding requires regeneration + a deployment env update | PASS | `providerRotationSteps` mentions generating a new random secret; `deploymentEnvUpdateSteps` non-empty; gates include `deployment_env_mutation` and `production_restart_redeploy` |
| 8 | history rewrite requires its own explicit approval, separate from rotation | PASS | `git_history_rewrite`/`force_push` gates are distinct `RemediationGateRecord`s from the rotation gate; approving the rotation gate leaves the rewrite gate `pending` |
| 9 | a decided gate is immutable and an unknown gate errors | PASS | deciding an already-decided gate throws `RemediationGateError`; deciding a nonexistent gate id throws the same |
| 10 | dry-run adapters never make a live call and always confirm no real mutation | PASS | every advisory returned has `blocked === true` and `noRealMutationConfirmed === true`; exactly 6 adapters registered |
| 11 | evidence package stores no raw secret material | PASS | the in-memory evidence object and every artifact file actually written to `.foundry-test-data/secret-remediation/artifacts/` are re-scanned and come back clean |
| 12 | operator surface returns full remediation status for a finding and an aggregate report | PASS | per-finding status includes `verdict`, `requiredApprovals`, `remainingOwnerActions`, and an always-empty `liveStepsExecuted`; aggregate report's `totalFindings`/`bySeverity`/`pendingApprovals` match |
| 13 | PantiCandy and vITALCore fixtures ingest end-to-end with no real provider calls | PASS | all 6 fixture cases (2 PantiCandy + 4 vITALCore) ingest, every advisory across all of them is blocked/no-mutation-confirmed |

**Result: 13/13 new tests pass.**

## Full repo suite

`npm test` ran the entire existing suite plus the new file: **124/124 pass**
(111 pre-existing + 13 new), zero regressions.

## Typecheck

`npm run typecheck` (`tsc --noEmit`) — clean, 0 errors, no changes needed to
any pre-existing file.

## Build

`npm run build` (`next build`) — compiled successfully; `/api/secret-remediation`
appears in the route table as a dynamic (`ƒ`) route alongside the existing
`/api/ops`, `/api/plan`, etc.; no new warnings.

## Proof script

`npm run proof:secret-remediation` — all 9 steps PASS. Evidence bundle written
to `proof/evidence/secret-remediation-proof.json`. See
`FOUNDRY_SECRET_REMEDIATION_PROOF.md` for detail.

## Secret scan

`detect-secrets scan` (Python `detect-secrets` v1.5.0, already present on this
machine — no dedicated secret-scan npm script exists in this repo, same as
the prior email-qa mission) against every new file (`lib/secret-remediation/**`,
`app/api/secret-remediation/route.ts`, `tests/secret-remediation.test.ts`,
`scripts/secret-remediation-proof.ts`, this mission's markdown docs):
**15 heuristic "Secret Keyword"/"GitHub Token" matches, 0 real secrets.**

Every match was manually inspected against its source line and is one of two
things, never a real credential:

- **Field/enum names containing the word "secret"** (`secretCategory: "github_pat"`,
  `secretCategory: "database_url"`, etc., and the two `appliesTo()` category
  comparisons in the adapters) — `detect-secrets`'s keyword heuristic flags any
  `identifier_containing_secret_word: "quoted string"` shape regardless of
  content; these are contract enum values, not secrets.
- **One deliberately fake, non-functional PAT-shaped string**
  (`scripts/secret-remediation-proof.ts` line 54: `"found ghp_1234567890abcdefghij1234567890abcdEF in the file"`, and
  the equivalent literal test strings in `tests/secret-remediation.test.ts`) —
  these exist specifically to prove step 1 above (raw secret rejection); the
  scanner correctly recognized the *shape*, which is exactly why Foundry's own
  `scanForRawSecretMaterial` also rejects it. It was never a real, currently or
  previously valid GitHub token.

**PASS WITH FINDINGS** — all 15 reviewed and confirmed non-secret.
