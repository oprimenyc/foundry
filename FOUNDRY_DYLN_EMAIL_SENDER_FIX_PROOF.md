# Foundry — dyln Email Sender Fix — Proof

## Claim
Foundry's independently-computed dyln email QA evidence now shows 17/17 PASS (previously
16 PASS / 1 FAIL on `follow-up-email`), against the repaired dyln HEAD `214e401`.

## Evidence

### 1. Integration proof rerun
```
npm run proof:email-qa-dyln
```
```
✓ 1. all dyln Tier A fixtures loaded and run — loaded 17 fixture(s)
✓ 2. dyln repo path/HEAD/branch captured — head=214e401a136b8d409a97ff31c37565d2cf7f2a1d, branch=feat/v1-deterministic-layer
✓ 3. no real provider call made for any dyln fixture — providerCallMade=true count: 0
✓ 4. every fixture has evidence/inbox/hash refs — checked 17 fixture(s)
✓ 5. only the known follow-up-email sender-mismatch gap fails; nothing else FAILs or is BLOCKED — verdicts={"PASS":17}
✓ 6. evidence bundle written and retained as a Foundry artifact
```
Verdict breakdown: `{"PASS": 17}` — zero FAIL, zero BLOCKED. Written to
`proof/evidence/dyln-email-qa-integration-proof.json`.

### 2. Cross-repo governance binding proof rerun
```
npm run proof:dyln-governance-binding
```
```
✓ 2. dyln repo HEAD is consistent across Foundry evidence, VERIDIAN admission, and E.V.E. verification
   — foundry=214e401..., veridianAdmission=214e401..., veridianEve=214e401...
✓ 3. all three verdicts are well-formed values ... — foundry=PASS, veridianAdmission=PASS, eve=PASS
✓ 4-7. all safety flags false, all 17 fixtures non-production / no provider call
```
Written to `proof/evidence/dyln-email-governance-binding-proof.json`.

### 3. Test suite
```
npm test
```
174/174 tests pass, including:
- `full dyln integration: 17 real fixtures, no provider call, inbox capture, evidence refs all present` — now asserts zero FAIL/BLOCKED fixtures (was `["follow-up-email"]`).
- `integration evidence carries product config hash ...` — now asserts `follow-up-email` verdict `PASS`, `senderValidation.ok === true`, `finalVerdict === "PASS"` (was `FAIL`/`false`/`"FAIL"`).
- `dyln's known sender-mismatch gap ... surfaces as an explained FAIL` — unchanged; this test injects its own synthetic mismatched-sender fixture to verify the harness's detection logic in isolation, independent of dyln's real (now-fixed) state.

### 4. No live provider call
`LocalFixtureAdapter` is the only adapter used by every proof script and test — no HTTP client,
no Resend SDK call, no network access. `providerCallMade: false` verified for all 17 fixtures
in the regenerated evidence bundle.

### 5. dyln repo untouched by Foundry
`dylnRepoWritten: false` in every evidence bundle. Foundry only `readFileSync`/`readdirSync`s
dyln's fixture JSON files and shells out to read-only `git -C <dylnRepoPath> rev-parse HEAD` /
`git branch --show-current`.
