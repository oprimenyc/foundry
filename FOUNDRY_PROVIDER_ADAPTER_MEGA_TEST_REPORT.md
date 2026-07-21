# Foundry Provider Action Adapter — Test Report

## Unit tests: `tests/provider-actions.test.ts`

Run: `node --import tsx --test tests/provider-actions.test.ts` -> **27/27 pass**.

| Area | Tests |
|---|---|
| Contract validation | well-formed request validates; raw secret material rejected; missing required field rejected |
| Approval policy engine | GitHub PAT revocation, DB rotation, Google OAuth rotation, NextAuth regeneration (+env gate), Railway env update, production-vs-staging `production_target` tiering, git-history-rewrite vs. force-push as separate gates, DNS always requires `dns_mutation` and never `production_target`, health-verify requires no gates |
| Mutation risk | none/medium/critical/high scaling across action type + environment |
| Ingest pipeline | unsupported provider/action pair rejected; mutation-with-no-approval is BLOCKED; blocked prerequisite is BLOCKED regardless of approval; DNS advisory is PASS_WITH_WARNINGS; fully-pre-approved mutation is capped at PASS_WITH_WARNINGS (never PASS); non-mutating health-verify reaches plain PASS with zero gates raised; every advisory asserts `mutationDisabled`/`liveCallMade:false`; evidence never contains raw secret material |
| Gate lifecycle | a decided gate is immutable (deciding twice throws); operator surface reflects live gate decisions while the evidence package's own verdict stays a frozen ingest-time snapshot |
| End-to-end | all 10 fixtures present; full pipeline over all 10 with exact expected verdicts and operator-report tally; the Railway staging fixture's gates can be approved live |

## Proof script: `scripts/provider-action-adapter-proof.ts`

Run: `npm run proof:provider-actions` -> **37/37 steps pass**. See `FOUNDRY_PROVIDER_ADAPTER_MEGA_PROOF.md` for the per-fixture verdict table this proves.

## Regression

- Full Foundry suite (`npm test`, all of `tests/**/*.test.ts` including the new file): **169/169 pass** (142 pre-existing + 27 new).
- `npm run typecheck` (`tsc --noEmit`): clean, zero errors.
- `npm run build` (`next build`): compiles successfully; `/api/provider-actions` route present in the build's route table.
- Manual secret scan (grep for GitHub-PAT/Stripe/AWS/Slack/private-key/Bearer-token shapes) over every new file in `lib/provider-actions/`, `app/api/provider-actions/`, `scripts/provider-action-adapter-proof.ts`, and the retained `proof/evidence/provider-action-adapter-proof.json`: clean. The one match found (`tests/provider-actions.test.ts`) is the single deliberately-fake token used to test the rejection path — confirmed absent from every retained evidence file.

## Not run

- No dedicated `secret-scan` npm script exists in this repo; the manual grep above is the same method used by every prior mission in this repo (`local-execution`, `dyln` email bridge) when no dedicated tool was available.
- No live provider integration test exists or was attempted — this module has no live-call code path to test.
