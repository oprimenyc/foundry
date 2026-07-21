# FOUNDRY_FYLR_BILLING_BRIDGE_NEXT_SESSION_HANDOFF.md

## Status: COMPLETE for Foundry's side, verdict PASS_WITH_WARNINGS

Everything in this mission's Foundry scope is built, tested, and committed.
No further Foundry work is required to consider this bridge live.

## What exists now

- `lib/fylr-billing/{types,evidence,operator}.ts`, `lib/fylr-billing/fixtures/fylr-loader.ts`
- `scripts/fylr-billing-bridge-proof.ts` — run via `npm run proof:fylr-billing-bridge`
- `proof/evidence/fylr-billing-bridge-proof.json` — the committed, durable evidence artifact VERIDIAN's E.V.E. bridge reads

## How to re-verify from scratch

```
cd C:\Users\jp718\foundry
npm run proof:fylr-billing-bridge   # 9/9 steps, verdict PASS_WITH_WARNINGS
npm run typecheck                    # clean
npm test                             # 183/183, full existing suite
npm run build                        # clean
```

## The one open item (by design, not an oversight)

fylr has no dedicated unit test that deliberately posts a wrong
`Stripe-Signature` and asserts a 400 rejection — the rejecting code itself is
real (`app/billing.py:816-831`, `stripe.Webhook.construct_event` +
`SignatureVerificationError` → 400), it is simply not yet exercised by a
test that supplies a bad signature. This is why the verdict is
`PASS_WITH_WARNINGS` rather than a plain `PASS`, both here and in VERIDIAN's
independent E.V.E. verification. To close this gap:

1. Add a test to `tests/test_billing_lifecycle.py` (in the **fylr** repo —
   out of scope for Foundry/VERIDIAN to write, since both must not modify
   fylr) that posts to `/billing/webhook` with a deliberately wrong
   `Stripe-Signature` header and asserts a 400 response.
2. Re-run `npm run proof:fylr-billing-bridge` — once that test exists and
   passes, add its node id to the `has()` check backing the
   `UNSIGNED_WEBHOOK_REJECTION_UNIT_TESTED` coverage entry in
   `lib/fylr-billing/evidence.ts::buildLifecycleCoverage()`, and the verdict
   will become a plain `PASS`.

## If fylr's billing lifecycle code changes in the future

Re-run `npm run proof:fylr-billing-bridge` — it dynamically re-invokes fylr's
real pytest suite every time (never a cached/static claim), so any
regression in fylr's billing lifecycle will surface immediately as a
`FYLR_TEST_SUITE_FAILED` rejection finding and a `BLOCKED` verdict.

## Downstream dependents

- `C:\Users\jp718\Downloads\workspace-847129d7-6103-4bd5-bf51-eaa3c760dd0f\src\lib\eve\fylr-billing-evidence-bridge.ts` reads
  `proof/evidence/fylr-billing-bridge-proof.json` from this exact path by
  default (overridable via `FOUNDRY_FYLR_BILLING_EVIDENCE_PATH`). If this
  file's path or top-level shape ever changes, that module's
  `readFoundryFylrBillingEvidence()`/`mapFoundryEvidenceToEveSubmission()`
  must be updated in lockstep (VERIDIAN repo, not this one).
