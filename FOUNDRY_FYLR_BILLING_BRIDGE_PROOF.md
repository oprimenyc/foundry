# FOUNDRY_FYLR_BILLING_BRIDGE_PROOF.md

## What this proves

That Foundry can build a machine-readable, independently-verifiable evidence
package for fylr's Stripe subscription billing lifecycle — entirely from
fylr's own real, already-committed code and passing pytest suite, invoked
read-only — without ever calling live Stripe, without ever mutating fylr,
and without ever mutating any provider state.

## Command run

```
cd C:\Users\jp718\foundry
npm run proof:fylr-billing-bridge
```

## Raw output (all 9 steps PASSED)

```
✓ 1. fylr repo path/HEAD/branch captured read-only — path=C:\REPLIT PROJECTS\fylr\fylr, head=beba52a9a178a9935ef90b157dceb585aa8f4f2d, branch=main
✓ 2. fylr HEAD is at the expected billing lifecycle commit — expected=beba52a9a178a9935ef90b157dceb585aa8f4f2d, actual=beba52a9a178a9935ef90b157dceb585aa8f4f2d
✓ 3. Foundry evidence package built from fylr's real pytest run — evidenceId=art_f895bf081d0deeaf5a4de638, verdict=PASS_WITH_WARNINGS
✓ 4. fylr billing lifecycle pytest run captured passing test proof refs — testProofRefs=9: tests/test_billing_lifecycle.py::test_payment_succeeded_clears_grace_period, tests/test_billing_lifecycle.py::test_subscription_past_due_does_not_downgrade_and_preserves_grace, tests/test_billing_lifecycle.py::test_subscription_past_due_starts_defensive_grace_if_none_active, tests/test_billing_lifecycle.py::test_subscription_deleted_downgrades_to_free, tests/test_billing_lifecycle.py::test_subscription_updated_canceled_downgrades_to_free, tests/test_billing_lifecycle.py::test_webhook_unknown_customer_is_safe_noop, tests/test_billing_lifecycle.py::test_full_lifecycle_recovery_never_downgrades, tests/test_silent_failures.py::test_webhook_idempotency_no_double_fulfill, tests/test_silent_failures.py::test_sf05_webhook_double_commit_failure_returns_5xx
✓ 5. no rejection findings — clean
✓ 6. final verdict allows readiness (PASS or PASS_WITH_WARNINGS) — verdict=PASS_WITH_WARNINGS
✓ 7. all live-provider/mutation flags are false — liveStripeCallFlag=false, providerMutatedFlag=false, productMutatedFlag=false
✓ 8. operator report reflects the evidence verdict and safety flags — status=PASS_WITH_WARNINGS
✓ 9. fylr repo HEAD unchanged after this proof ran — before=beba52a9a178a9935ef90b157dceb585aa8f4f2d, after=beba52a9a178a9935ef90b157dceb585aa8f4f2d

Evidence bundle written: C:\Users\jp718\foundry\proof\evidence\fylr-billing-bridge-proof.json

All 9 proof steps PASSED. No live Stripe call, no provider mutation, no fylr mutation.
```

## Why the verdict is PASS_WITH_WARNINGS, not a plain PASS

Every core money-safety behavior (payment recovery clearing grace, past_due
honoring grace, cancellation downgrading to FREE, idempotent duplicate-event
handling, safe no-op on unmatched customers, the full recovery-never-downgrades
integration path) is confirmed by a real, passing fylr test. The one open gap:
fylr's webhook handler genuinely verifies `Stripe-Signature` via
`stripe.Webhook.construct_event` and rejects with 400 on
`SignatureVerificationError` (`app/billing.py:816-831`), but no test in
fylr's committed suite deliberately posts a wrong signature and asserts that
rejection. This is reported honestly as a warning-severity coverage gap
(`UNSIGNED_WEBHOOK_REJECTION_UNIT_TESTED: present=false`) rather than silently
assumed or silently dropped.

## Evidence artifact

`proof/evidence/fylr-billing-bridge-proof.json` (committed) — contains the
full `FylrBillingEvidencePackage`, the operator report, and the proof step
log reproduced above.

## Safety confirmation

- Live Stripe called: **NO**
- Provider (Stripe) state mutated: **NO**
- fylr (product) mutated: **NO** (HEAD identical before/after every run)
- Secrets exposed: **NO** (secret scan clean — see `FOUNDRY_FYLR_BILLING_BRIDGE_TEST_REPORT.md`)
