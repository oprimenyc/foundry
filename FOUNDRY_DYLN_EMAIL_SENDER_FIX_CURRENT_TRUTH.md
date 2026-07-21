# Foundry — dyln Email Sender Fix — Current Truth

## Repo
`C:\Users\jp718\foundry`

## Branch
`mission/m3-vault-intelligence`

## Starting HEAD
`872e63caebb854808f8046fe8a06f88bb0b453e5` (working tree clean at session start).

## dirty tree summary
Clean at session start. After this mission's work: exactly 3 files modified —
`proof/evidence/dyln-email-qa-integration-proof.json`,
`proof/evidence/dyln-email-governance-binding-proof.json` (regenerated evidence, not hand-edited),
and `tests/email-qa-dyln.test.ts` (source edit — see below).

## Unrelated dirty files preserved
None — Foundry had no unrelated dirty state to preserve.

## Files inspected
- `lib/email-qa/fixtures/dyln.config.ts`, `lib/email-qa/fixtures/dyln-loader.ts` — the existing
  harness that reads dyln's real fixture JSON files read-only. **Not modified** — it consumed
  the repaired dyln evidence correctly with zero code changes (verified by rerunning
  `npm run proof:email-qa-dyln`).
- `scripts/dyln-email-qa-proof.ts` — the proof script that produces
  `proof/evidence/dyln-email-qa-integration-proof.json`. **Not modified** — its assertions
  (`unexpectedFailures.length === 0 && !anyBlocked`) already tolerated a fully-passing result
  without change.
- `scripts/dyln-email-governance-binding-proof.ts` — cross-repo binding proof. **Not modified** —
  generic HEAD/verdict consistency checks, no hardcoded dyln-specific expectations.
- `tests/email-qa-dyln.test.ts` — **modified**. Two tests ran the real integration against
  dyln's live fixtures and hardcoded the pre-fix expectation (`follow-up-email` verdict
  `"FAIL"`, integration `finalVerdict` `"FAIL"`). These would now fail against the repaired
  dyln repo, so they were updated to expect `"PASS"` (see implementation report). A third test
  (`"dyln's known sender-mismatch gap ... surfaces as an explained FAIL"`) constructs its own
  **synthetic** fixture object inline with a deliberately-injected mismatched sender — it does
  not read dyln's real fixtures and continues to correctly verify the harness's own
  SENDER_MISMATCH detection logic. Left unchanged.

## Confirmed defect source
Same as dyln's own current-truth doc: `emailFollowUpService.ts` previously defaulted to
`noreply@getdyln.com`; dyln closed this in commit `214e401` ("fix follow up email sender
identity"). Foundry's harness treats dyln's fixture JSON files as a language-agnostic data
contract (`senderFrom` field) and never imports dyln source — it correctly reported `FAIL`
before the fix and correctly reports `PASS` after, with zero harness-logic changes required.

## Planned minimal fix (Foundry side)
1. Rerun `npm run proof:email-qa-dyln` against the repaired dyln HEAD (`214e401`) to regenerate
   `proof/evidence/dyln-email-qa-integration-proof.json` — now shows 17/17 PASS.
2. Rerun `npm run proof:dyln-governance-binding` to regenerate
   `proof/evidence/dyln-email-governance-binding-proof.json` — now shows all three cross-repo
   verdicts as PASS with matching dyln HEAD.
3. Update the two `tests/email-qa-dyln.test.ts` assertions that hardcoded the pre-fix real-fixture
   outcome, so `npm test` reflects reality instead of a stale, now-false expectation.

## Live-provider restrictions
No real email sent. No Resend API called (`LocalFixtureAdapter` only, `providerCallMade: false`
confirmed for every fixture in the regenerated evidence). No production users targeted. No dyln
repo file was read-written by Foundry (`dylnRepoWritten: false`). No secrets, DNS, or deployment
touched.
