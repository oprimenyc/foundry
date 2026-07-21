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
✓ 1. fylr repo path/HEAD/branch captured read-only — path=C:\REPLIT PROJECTS\fylr\fylr, head=aecb6bc4aec2baf505557a13459cc116fcde514d, branch=main
✓ 2. fylr HEAD is at the expected billing lifecycle commit — expected=aecb6bc4aec2baf505557a13459cc116fcde514d, actual=aecb6bc4aec2baf505557a13459cc116fcde514d
✓ 3. Foundry evidence package built from fylr's real pytest run — evidenceId=art_c874dedc783d8c63b3da2f3b, verdict=PASS
✓ 4. fylr billing lifecycle pytest run captured passing test proof refs — testProofRefs=17: tests/test_billing_lifecycle.py::test_payment_succeeded_clears_grace_period, tests/test_billing_lifecycle.py::test_subscription_past_due_does_not_downgrade_and_preserves_grace, tests/test_billing_lifecycle.py::test_subscription_past_due_starts_defensive_grace_if_none_active, tests/test_billing_lifecycle.py::test_subscription_deleted_downgrades_to_free, tests/test_billing_lifecycle.py::test_subscription_updated_canceled_downgrades_to_free, tests/test_billing_lifecycle.py::test_webhook_unknown_customer_is_safe_noop, tests/test_billing_lifecycle.py::test_full_lifecycle_recovery_never_downgrades, tests/test_silent_failures.py::test_webhook_idempotency_no_double_fulfill, tests/test_silent_failures.py::test_sf05_webhook_double_commit_failure_returns_5xx, tests/test_webhook_signature_rejection.py::test_missing_signature_header_is_rejected, tests/test_webhook_signature_rejection.py::test_empty_signature_header_is_rejected, tests/test_webhook_signature_rejection.py::test_malformed_signature_header_is_rejected, tests/test_webhook_signature_rejection.py::test_signature_signed_with_wrong_secret_is_rejected, tests/test_webhook_signature_rejection.py::test_tampered_payload_after_signing_is_rejected, tests/test_webhook_signature_rejection.py::test_rejected_webhook_does_not_trigger_business_logic, tests/test_webhook_signature_rejection.py::test_valid_signature_is_accepted_control, tests/test_webhook_signature_rejection.py::test_legacy_route_also_rejects_missing_signature
✓ 5. no rejection findings — clean
✓ 6. final verdict allows readiness (PASS or PASS_WITH_WARNINGS) — verdict=PASS
✓ 7. all live-provider/mutation flags are false — liveStripeCallFlag=false, providerMutatedFlag=false, productMutatedFlag=false
✓ 8. operator report reflects the evidence verdict and safety flags — status=PASS
✓ 9. fylr repo HEAD unchanged after this proof ran — before=aecb6bc4aec2baf505557a13459cc116fcde514d, after=aecb6bc4aec2baf505557a13459cc116fcde514d

Evidence bundle written: C:\Users\jp718\foundry\proof\evidence\fylr-billing-bridge-proof.json

All 9 proof steps PASSED. No live Stripe call, no provider mutation, no fylr mutation.
```

## Why the verdict is now a plain PASS

Every core money-safety behavior (payment recovery clearing grace, past_due
honoring grace, cancellation downgrading to FREE, idempotent duplicate-event
handling, safe no-op on unmatched customers, the full recovery-never-downgrades
integration path) is confirmed by a real, passing fylr test. The formerly-open
gap — fylr's webhook handler genuinely verifies `Stripe-Signature` via
`stripe.Webhook.construct_event` and rejects with 400 on
`SignatureVerificationError` (`app/billing.py:816-831`), but no test in
fylr's committed suite deliberately posted a wrong/missing signature and
asserted that rejection — is now closed. fylr commit
`aecb6bc4aec2baf505557a13459cc116fcde514d` ("add unsigned webhook rejection
tests") added `tests/test_webhook_signature_rejection.py`: 8 tests that,
without mocking `app.billing.stripe`, exercise the real
`stripe.Webhook.construct_event` verification path against a missing,
empty, or malformed `Stripe-Signature` header, a signature signed with the
wrong secret, and a payload tampered with after signing — all asserted
`400 {"error": "Invalid signature"}` with zero `StripeWebhookEvent` rows
written and zero business-logic side effects — plus a control test proving
a genuinely valid signature is still accepted, and a check that the legacy
`/api/webhooks/stripe` alias enforces the same rejection.
`UNSIGNED_WEBHOOK_REJECTION_UNIT_TESTED` now reads `present=true`, there are
no remaining coverage gaps (10/10) and no rejection findings, so the verdict
is a full `PASS`.

## Evidence artifact

`proof/evidence/fylr-billing-bridge-proof.json` (committed) — contains the
full `FylrBillingEvidencePackage`, the operator report, and the proof step
log reproduced above.

## Safety confirmation

- Live Stripe called: **NO**
- Provider (Stripe) state mutated: **NO**
- fylr (product) mutated: **NO** (HEAD identical before/after every run)
- Secrets exposed: **NO** (secret scan clean — see `FOUNDRY_FYLR_BILLING_BRIDGE_TEST_REPORT.md`)
