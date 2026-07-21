# Foundry — dyln Email Sender Fix — Test Report

## Commands run
```
npm run proof:email-qa-dyln           # regenerates dyln-email-qa-integration-proof.json
npm run proof:dyln-governance-binding # regenerates dyln-email-governance-binding-proof.json
npm test                              # full Foundry test suite
```

## Results
- `proof:email-qa-dyln`: 6/6 proof steps PASS. Verdict breakdown `{"PASS": 17}`.
- `proof:dyln-governance-binding`: 7/7 proof steps PASS. All three cross-repo verdicts PASS,
  dyln HEAD consistent (`214e401a136b8d409a97ff31c37565d2cf7f2a1d`) across Foundry, VERIDIAN
  admission, and VERIDIAN E.V.E. evidence.
- `npm test`: 174/174 tests pass, 0 failures, 0 cancelled.

## Provider/network isolation confirmed
- `LocalFixtureAdapter` only — no Resend SDK import in any dyln-related script or test.
- `providerCallMade: false` for all 17 fixtures.
- `dylnRepoWritten: false`, `realProviderCallsMade: false` in both evidence bundles.
- No production recipient in any fixture (all `@dyln.test`).

## Typecheck / build / lint
Not run for this mission — no `.ts` type shape changed (only string constant values and test
assertions edited); Foundry's own `npm test` already exercises the affected modules via
`--import tsx` (which type-strips but does not full-typecheck) and passed cleanly. No compiler
errors surfaced during the test run.

## Secret scan
```
git diff -- proof/evidence tests/email-qa-dyln.test.ts \
  | grep -iE "api[_-]?key|secret|token|password|bearer|sk_live|sk_test|resend_[a-z0-9]{10,}"
```
Result: **PASS** — no matches (evidence bundle field names like `productId`/`missionId`/
`senderIdentity` do not match the secret patterns).
