# Foundry — dyln Governance Bridge: Implementation Report

## Scope

Two ordered phases, entirely inside Foundry's write boundary (`C:\Users\jp718\foundry`), no dyln mutation, no live provider call, no push.

## Phase 1 — Local execution evidence adapter (new)

Added `lib/local-execution/` from scratch, mirroring `lib/secret-remediation/`'s existing structure exactly (contract types → pure policy/verdict engine → ingest/normalize with structural rejections → evidence orchestrator over the existing `retainArtifact` store → operator/query surface → API route → proof script → tests):

- `types.ts`, `policy.ts`, `ingest.ts`, `ids.ts`, `evidence.ts`, `operator.ts`
- `fixtures/` — 6 required scenarios (J-code blocked, Wigolo blocked, Ollama CPU-slow, PrimeOS-tier proof, blocked provider mutation, blocked secret exposure) + `index.ts`
- `app/api/local-execution/route.ts`
- `scripts/local-execution-proof.ts` (`npm run proof:local-execution`)
- `tests/local-execution.test.ts` (17 tests)

Two policy rules were added beyond the mission's literal checklist, both necessary to make the six required fixtures' verdicts honest rather than merely plausible:
- **all-commands-failed → `BLOCKED`** (not just a warning) — otherwise "J-code not installed" and "Wigolo install failed" would read as ordinary partial successes.
- **slow-execution (>120s) → warning** — gives the "Ollama CPU-only slow run" fixture a real, distinct `PASS_WITH_WARNINGS` signal instead of a silent clean `PASS`.

## Phase 2.2 — Extended existing dyln email QA evidence (additive)

`lib/email-qa/fixtures/dyln-loader.ts` (pre-existing, from `90e09b7`) was missing several fields the mission's evidence contract requires. Extended, additively, with zero behavior change to existing exports:

- `productConfigHash` (top-level and per-fixture)
- Per-fixture `senderValidation`, `replyToValidation`, `placeholderCheck`, `linkCheck`, `assetCheck` (pulled straight through from the evidence package `runEmailQaAndProduceEvidence` already computes — no new validation logic written)
- `productionRecipient` (derived: `true` iff the recipient address is not a confirmed `@dyln.test` address — always `false` for every real dyln fixture)
- Captured content (`capturedSenderIdentity`, `capturedFromAddress`, `capturedReplyToAddress`, `capturedSubject`, `capturedRenderedBody`, `capturedTemplateVariables`, `capturedRequiredLinks`, `capturedRequiredAssets`) plus **Foundry-committed** `capturedSubjectHash`/`capturedRenderedBodyHash` — added specifically so a downstream independent verifier (VERIDIAN's E.V.E.) gets real tamper evidence, not a self-referential hash check
- Top-level `finalVerdict` — worst-of aggregation (`aggregateEmailQaVerdicts`) across all 17 fixtures

Existing tests (`tests/email-qa-dyln.test.ts`, 8 tests) still pass unmodified; one new test was added covering the extended fields (9 total). `scripts/dyln-email-qa-proof.ts` required no changes — it already serializes the whole bundle, so the new fields flow through automatically.

**Correction made mid-mission**: `capturedReplyToAddress` was initially wired to Foundry's own `EmailPayload.replyTo` (undefined unless `replyToExplicit: true`), which turned out to make all 17 fixtures look reply-to-less to an independent verifier. Changed to carry dyln's declared `replyToExpected` (the effective reply-to) instead — see `FOUNDRY_DYLN_EMAIL_BRIDGE_PROOF.md` for the full account. Foundry's own `mapDylnFixtureToPayload` and `validate.ts` were **not** touched.

## Phase 2.4 — Cross-repo evidence binding (new)

`scripts/dyln-email-governance-binding-proof.ts` (`npm run proof:dyln-governance-binding`) reads Foundry's own evidence file plus two VERIDIAN evidence JSON files (read-only, path overridable via `VERIDIAN_REPO_PATH`, no VERIDIAN source code imported), cross-checks dyln HEAD consistency and every safety flag across all three sources, and writes `proof/evidence/dyln-email-governance-binding-proof.json`.

## Files changed/added in Foundry

```
lib/local-execution/                          (new — 8 files + 6 fixtures)
app/api/local-execution/route.ts              (new)
scripts/local-execution-proof.ts              (new)
scripts/dyln-email-governance-binding-proof.ts (new)
tests/local-execution.test.ts                 (new)
lib/email-qa/fixtures/dyln-loader.ts          (modified — additive fields only)
tests/email-qa-dyln.test.ts                   (modified — one test added)
package.json                                   (modified — 2 npm scripts added)
.gitignore                                     (modified — 1 sandbox dir excluded)
proof/evidence/dyln-email-qa-integration-proof.json   (regenerated)
proof/evidence/local-execution-evidence-proof.json    (new)
proof/evidence/dyln-email-governance-binding-proof.json (new)
```

## Verification

- `npm test` (full suite): 142/142 pass.
- `npm run typecheck`: clean.
- `npm run build`: succeeds; `/api/local-execution` present in route table.
- Manual secret scan: clean (one deliberately-fake token confined to its test fixture, never leaked into retained evidence).

See `FOUNDRY_LOCAL_EXECUTION_PROOF.md`, `FOUNDRY_LOCAL_EXECUTION_TEST_REPORT.md`, and `FOUNDRY_DYLN_EMAIL_BRIDGE_PROOF.md` for full detail.
