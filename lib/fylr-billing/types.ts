/**
 * Foundry FYLR Billing Evidence Bridge — contract types.
 *
 * FYLR (C:\REPLIT PROJECTS\fylr\fylr, read-only source of truth) already has
 * a committed, passing Stripe subscription-lifecycle test suite
 * (tests/test_billing_lifecycle.py + the idempotency/failure-path tests in
 * tests/test_silent_failures.py) exercising the real /billing/webhook route
 * with genuine HMAC-signed payloads (app/billing.py::_handle_stripe_webhook).
 * This module does not rebuild fylr's billing logic or its tests — it
 * defines Foundry's evidence-package wrapper around fylr's own real,
 * already-committed test suite, invoked read-only, so the capability can
 * flow fylr -> Foundry -> VERIDIAN -> E.V.E. without Foundry ever writing to
 * the fylr repo/database or calling live Stripe.
 *
 * Same design rule as lib/amos-youtube/types.ts: nothing here performs a
 * live provider action. `liveStripeCallFlag`/`providerMutatedFlag`/
 * `productMutatedFlag` are always Literal[false] — this bridge only reads
 * fylr's repo state and runs its existing pytest suite against fylr's own
 * in-memory sqlite:// test database (never fylr's real database or files).
 */

export const FYLR_BILLING_VERDICTS = ["PASS", "FAIL", "BLOCKED", "PASS_WITH_WARNINGS"] as const;
export type FylrBillingVerdict = (typeof FYLR_BILLING_VERDICTS)[number];

/** Read-only fylr repo identity, captured via `git -C <fylrRepoPath>` — never mutates fylr. */
export interface FylrRepoState {
  repoPath: string;
  head: string;
  branch: string;
}

/** Result of read-only-invoking fylr's own committed billing lifecycle pytest suite. */
export interface FylrBillingTestRunResult {
  command: string;
  exitCode: number;
  passed: number;
  failed: number;
  testNames: string[];
  rawTail: string;
}

/** One required lifecycle-behavior check in the coverage checklist (mission Phase 2/3 required list). */
export interface FylrBillingLifecycleEventCheck {
  code: string;
  label: string;
  present: boolean;
}

/**
 * Rejection reasons Foundry's evidence builder enforces (mission Phase 3
 * "must reject" list). Any one of these present blocks a PASS verdict.
 */
export const FYLR_BILLING_REJECTION_CODES = [
  "MISSING_PRODUCT_HEAD",
  "MISSING_EVENT_COVERAGE",
  "MISSING_PROOF_REFS",
  "LIVE_STRIPE_CALL_WITHOUT_APPROVAL",
  "PROVIDER_MUTATION_WITHOUT_APPROVAL",
  "PRODUCT_MUTATION_WITHOUT_APPROVAL",
  "RAW_SECRET_DETECTED",
  "UNSIGNED_WEBHOOK_PROOF_REQUIRED",
  "CANCELLATION_DOWNGRADE_TO_PAID_TIER",
  "INSTANT_DOWNGRADE_WITHOUT_GRACE_PERIOD",
  "FYLR_TEST_SUITE_FAILED",
] as const;
export type FylrBillingRejectionCode = (typeof FYLR_BILLING_REJECTION_CODES)[number];

export interface FylrBillingRejectionFinding {
  code: FylrBillingRejectionCode;
  message: string;
}

/** The standardized, machine-readable Foundry evidence package for fylr's Stripe billing lifecycle. */
export interface FylrBillingEvidencePackage {
  evidenceId: string;
  productId: "fylr";
  productName: "FYLR";
  productRepoPath: string;
  productHead: string;
  productBranch: string;
  billingDomain: "subscription_lifecycle";
  billingProviderClassification: "stripe_subscription_billing";
  lifecycleEventCoverage: FylrBillingLifecycleEventCheck[];
  webhookSignatureProofRef: string;
  testProofRefs: string[];
  commandEvidenceRefs: string[];
  expectedStateTransitions: string[];
  actualStateTransitionEvidence: string[];
  liveStripeCallFlag: false;
  providerMutatedFlag: false;
  productMutatedFlag: false;
  rejectionFindings: FylrBillingRejectionFinding[];
  verdict: FylrBillingVerdict;
  generatedAt: string;
}
