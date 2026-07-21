# FOUNDRY_EMAIL_QA_PROOF.md

Runtime proof for the free/local email QA harness. Run: `npm run proof:email-qa`.
Machine-readable bundle: `proof/evidence/email-qa-proof.json`
(`proof: "foundry-email-qa-harness@1"`, `realProviderCallsMade: false`).

## Steps executed and verified

| Step | Status | Detail |
|---|---|---|
| 1. dyln sample config validates | PASS | `ok=true, issues=0` |
| 2. valid welcome email passes via local fixture adapter | PASS | `verdict=PASS, mode=fixture, simulated=true` |
| 3. broken release-blocking email is BLOCKED | PASS | `verdict=BLOCKED, unresolved={{customerFirstName}},{{resetLink}}` |
| 4. virtual inbox stores messages | PASS | `stored 2 message(s)` |
| 5a. Resend boundary defaults to simulated, no real call | PASS | `mode=resend-test, liveCalled=false` |
| 5b. Resend boundary calls provider only with both explicit gates set | PASS | `mode=resend-live, liveCalled=true, simulated=false` |

All 6 steps PASSED on a clean sandbox (`.foundry-proof-email-qa/`, deleted and
recreated at the start of the run) — nothing in this proof depends on state
left over from a previous run.

## What step 5 actually demonstrates

The proof script constructs a stub Resend client whose `sendEmail` sets a
`liveCalled` flag and would fail the assertion if invoked unexpectedly:

- **5a** — an adapter with an API key present but neither `allowLiveSend`
  nor the `FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND` env flag set: `liveCalled`
  stays `false`. This is the harness's default state.
- **5b** — only after setting **both** `allowLiveSend: true` (a code-level
  call-site opt-in) **and** `FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND=explicit-live-send`
  does `liveCalled` flip to `true`. The env var is deleted again immediately
  after this step.

At no point in this proof run, or in `npm test`, did any request leave the
machine to `api.resend.com` or any other external host — `realProviderCallsMade: false`
in the bundle reflects that truthfully, not by assertion but because the only
adapter ever wired to a real (non-stub) `ResendAdapter` client would require
the env flag this script explicitly unsets before and after.

## Independent re-verification

Anyone can reproduce this proof with zero credentials and zero cost:

```
npm run proof:email-qa
```

The script fails closed — any step that doesn't hold throws before printing
`All N proof steps PASSED`, so a truncated or partial run is never mistaken
for success (consistent with `PrimeOS/CONSTITUTION.md` §1, No Silent Failures).
