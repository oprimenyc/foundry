# Foundry Local Execution Evidence Adapter — Test Report

## Unit tests: `tests/local-execution.test.ts`

Run: `node --import tsx --test tests/local-execution.test.ts` → **17/17 pass**.

| # | Test | Verifies |
|---|---|---|
| 1 | malformed evidence (not an object) is rejected | ingest structural guard |
| 2 | missing `missionId` is rejected | ingest structural guard |
| 3 | missing `adapterType` is rejected | ingest structural guard |
| 4 | missing/empty command log is rejected | ingest structural guard |
| 5 | evidence carrying secret-shaped material is rejected before policy runs, and the raw text never appears in the rejection record | secret-exposure rejection + no-leak invariant |
| 6 | provider mutation claimed with no gate reference at all is rejected outright | unapproved-mutation-claim rejection |
| 7 | provider mutation claimed *with* a gate reference (even unapproved) is accepted → `BLOCKED` | ingest vs. policy distinction |
| 8 | out-of-scope file mutation is detected | `findOutOfScopeFiles` |
| 9 | forbidden command class (`git_history_rewrite`) → `FAIL` | policy |
| 10 | a run where every command fails → `BLOCKED`, not a warning | policy (unreviewable-run rule) |
| 11 | missing proof artifacts warns at standard criticality, fails at high criticality | policy (criticality-scaled rule) |
| 12 | high-risk domain command class → `BLOCKED` + frontier review required | policy |
| 13 | a slow-but-successful run → `PASS_WITH_WARNINGS` | policy (slow-execution rule) |
| 14 | a clean run with no findings → plain `PASS` | policy baseline |
| 15 | all 6 required fixtures present | fixture inventory |
| 16 | full pipeline: all 6 fixtures ingest end-to-end with expected verdicts; operator report aggregates correctly | end-to-end |
| 17 | operator report entry for a rejected submission never fabricates a verdict | operator surface honesty |

## Proof script: `scripts/local-execution-proof.ts`

Run: `npm run proof:local-execution` → **13/13 steps pass**. See `FOUNDRY_LOCAL_EXECUTION_PROOF.md` for the per-fixture verdict table this proves.

## Regression

- Full Foundry suite (`npm test`, all of `tests/**/*.test.ts` including the new file): **142/142 pass**.
- `npm run typecheck` (`tsc --noEmit`): clean, zero errors.
- `npm run build` (`next build`): compiles successfully; `/api/local-execution` route present in the build's route table.
- Manual secret scan (`grep` for GitHub-PAT/Stripe/AWS/Slack/private-key shapes) over every new/changed file: clean, other than the one deliberately-fake token confined to `blocked-secret-exposure.fixture.json` and its matching test assertion (never leaked into any retained evidence).

## Not run

- No dedicated `secret-scan` npm script exists in this repo; the manual grep above is the same method dyln's own prior email-harness proof used when no dedicated tool was available.
