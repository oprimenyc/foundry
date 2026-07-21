import { retainArtifact } from "@/lib/foundry/artifacts";
import { scanForRawSecretMaterial } from "@/lib/secret-remediation/secret-scan";
import { getFylrRepoState, runFylrBillingLifecycleTests } from "./fixtures/fylr-loader";
import type {
  FylrBillingEvidencePackage,
  FylrBillingLifecycleEventCheck,
  FylrBillingRejectionFinding,
  FylrBillingTestRunResult,
  FylrBillingVerdict,
} from "./types";

const EVIDENCE_ARTIFACT_KIND = "fylr_billing_evidence_package";

/**
 * fylr HEAD confirmed read-only during mission Phase 1 (commit message: "Fix
 * Stripe subscription grace-period race and cancellation downgrade target").
 * Superseded by aecb6bc4aec2baf505557a13459cc116fcde514d ("add unsigned
 * webhook rejection tests"), which closes the UNSIGNED_WEBHOOK_REJECTION_UNIT_TESTED
 * coverage gap this bridge previously reported as a warning — see
 * tests/test_webhook_signature_rejection.py in the fylr repo.
 */
export const EXPECTED_FYLR_BILLING_HEAD = "aecb6bc4aec2baf505557a13459cc116fcde514d";

/**
 * Required lifecycle-behavior coverage checklist (mission Phase 2/3). Every
 * entry is derived from whether a specific, already-committed fylr test
 * actually PASSED in this run's real pytest output — nothing here is
 * asserted without a corresponding dynamic check.
 */
function buildLifecycleCoverage(testRun: FylrBillingTestRunResult): FylrBillingLifecycleEventCheck[] {
  const passed = (name: string) => testRun.testNames.some((t) => t.endsWith(name));
  return [
    { code: "PAYMENT_RECOVERY_CLEARS_GRACE_PERIOD", label: "invoice.payment_succeeded clears an active payment grace period", present: passed("test_payment_succeeded_clears_grace_period") },
    { code: "PAST_DUE_PRESERVES_GRACE_PERIOD", label: "customer.subscription.updated(past_due) does not downgrade and preserves an existing grace window", present: passed("test_subscription_past_due_does_not_downgrade_and_preserves_grace") },
    { code: "UNPAID_STARTS_DEFENSIVE_GRACE_PERIOD", label: "customer.subscription.updated(unpaid/past_due) starts a defensive grace window when none is active yet", present: passed("test_subscription_past_due_starts_defensive_grace_if_none_active") },
    { code: "CANCELLATION_DELETED_DOWNGRADES_TO_FREE", label: "customer.subscription.deleted downgrades the user to FREE, not a paid tier", present: passed("test_subscription_deleted_downgrades_to_free") },
    { code: "CANCELLATION_UPDATED_DOWNGRADES_TO_FREE", label: "customer.subscription.updated(status=canceled) downgrades the user to FREE", present: passed("test_subscription_updated_canceled_downgrades_to_free") },
    { code: "UNKNOWN_CUSTOMER_SAFE_NOOP", label: "a webhook referencing an unmatched customer is a safe no-op (200, no user row created)", present: passed("test_webhook_unknown_customer_is_safe_noop") },
    { code: "FULL_LIFECYCLE_RECOVERY_INTEGRATION", label: "full failed -> past_due -> recovered sequence never downgrades the plan, and un-recovered expiry still degrades access via middleware", present: passed("test_full_lifecycle_recovery_never_downgrades") },
    { code: "WEBHOOK_IDEMPOTENT_DUPLICATE_HANDLING", label: "a duplicate Stripe webhook event id is not double-processed (StripeWebhookEvent idempotency table)", present: passed("test_webhook_idempotency_no_double_fulfill") },
    { code: "WEBHOOK_FAILURE_PATH_RETURNS_5XX", label: "a handler failure whose 'failed' status also fails to persist still returns 5xx so Stripe retries", present: passed("test_sf05_webhook_double_commit_failure_returns_5xx") },
    {
      code: "UNSIGNED_WEBHOOK_REJECTION_UNIT_TESTED",
      label: "a deliberately invalid/wrong Stripe-Signature header is unit-tested as rejected (400)",
      present: [
        "test_missing_signature_header_is_rejected",
        "test_malformed_signature_header_is_rejected",
        "test_signature_signed_with_wrong_secret_is_rejected",
        "test_tampered_payload_after_signing_is_rejected",
      ].every(passed),
    },
  ];
}

export interface BuildFylrBillingEvidenceOptions {
  fylrRepoPath?: string;
}

/**
 * Builds Foundry's evidence package for fylr's Stripe billing lifecycle by
 * reading fylr's repo state read-only and invoking fylr's own, already
 * committed pytest suite exactly as-is. Never calls live Stripe, never
 * mutates fylr's database or files, never writes to the fylr repo. Enforces
 * the mission's Phase 3 "must reject" rules by capping the verdict at
 * BLOCKED whenever a rejection finding fires. The formerly-open coverage gap
 * (no dedicated unit test deliberately sent a wrong/missing Stripe-Signature
 * and asserted rejection) was closed in fylr commit
 * aecb6bc4aec2baf505557a13459cc116fcde514d by
 * tests/test_webhook_signature_rejection.py; if that suite and every other
 * required lifecycle check pass, this now yields a full PASS instead of
 * PASS_WITH_WARNINGS. A verdict still only ever reflects what the real,
 * already-committed pytest run reported — nothing here is asserted without
 * a corresponding dynamic check.
 */
export async function buildFylrBillingEvidence(options: BuildFylrBillingEvidenceOptions = {}): Promise<FylrBillingEvidencePackage> {
  const repo = getFylrRepoState(options.fylrRepoPath);
  const testRun = runFylrBillingLifecycleTests(options.fylrRepoPath);
  const lifecycleEventCoverage = buildLifecycleCoverage(testRun);

  const rejectionFindings: FylrBillingRejectionFinding[] = [];

  if (!repo.head) {
    rejectionFindings.push({ code: "MISSING_PRODUCT_HEAD", message: "fylr repo HEAD could not be read." });
  }
  if (testRun.testNames.length === 0) {
    rejectionFindings.push({ code: "MISSING_PROOF_REFS", message: "No passing test proof refs captured from the fylr billing lifecycle test run." });
  }
  if (testRun.exitCode !== 0 || testRun.failed > 0) {
    rejectionFindings.push({
      code: "FYLR_TEST_SUITE_FAILED",
      message: `fylr billing lifecycle test run did not exit cleanly (exitCode=${testRun.exitCode}, failed=${testRun.failed}).`,
    });
  }
  const cancellationDeletedCheck = lifecycleEventCoverage.find((c) => c.code === "CANCELLATION_DELETED_DOWNGRADES_TO_FREE");
  const cancellationUpdatedCheck = lifecycleEventCoverage.find((c) => c.code === "CANCELLATION_UPDATED_DOWNGRADES_TO_FREE");
  if (!cancellationDeletedCheck?.present || !cancellationUpdatedCheck?.present) {
    rejectionFindings.push({ code: "CANCELLATION_DOWNGRADE_TO_PAID_TIER", message: "No passing test confirms cancellation downgrades to FREE rather than a paid tier." });
  }
  const graceCheck = lifecycleEventCoverage.find((c) => c.code === "PAST_DUE_PRESERVES_GRACE_PERIOD");
  if (!graceCheck?.present) {
    rejectionFindings.push({ code: "INSTANT_DOWNGRADE_WITHOUT_GRACE_PERIOD", message: "No passing test confirms past_due/unpaid honors the grace period instead of an instant downgrade." });
  }
  const secretMatches = scanForRawSecretMaterial({ testRun });
  if (secretMatches.length > 0) {
    rejectionFindings.push({ code: "RAW_SECRET_DETECTED", message: "Raw secret-shaped material detected in captured test output." });
  }
  // liveStripeCallFlag / providerMutatedFlag / productMutatedFlag are always false by
  // construction — this bridge never sets them true anywhere, so LIVE_STRIPE_CALL_WITHOUT_APPROVAL,
  // PROVIDER_MUTATION_WITHOUT_APPROVAL, and PRODUCT_MUTATION_WITHOUT_APPROVAL are declared for
  // the mission's rejection vocabulary but structurally unreachable from this code path — mirrors
  // lib/amos-youtube/evidence.ts's discipline for its own always-false live-provider flags.

  const missingCoverage = lifecycleEventCoverage.filter((c) => !c.present);
  let verdict: FylrBillingVerdict;
  if (rejectionFindings.length > 0) {
    verdict = "BLOCKED";
  } else if (missingCoverage.length > 0) {
    verdict = "PASS_WITH_WARNINGS";
  } else {
    verdict = "PASS";
  }

  const expectedStateTransitions = [
    "invoice.payment_succeeded -> clears payment_grace_until, plan unchanged",
    "customer.subscription.updated(past_due) -> plan unchanged, grace window preserved or defensively started",
    "customer.subscription.updated(unpaid) -> plan unchanged, grace window preserved or defensively started",
    "customer.subscription.deleted -> plan downgraded to FREE, grace cleared",
    "customer.subscription.updated(status=canceled) -> plan downgraded to FREE",
    "unmatched customer_id on any subscription/invoice event -> 200 safe no-op, no user row created",
    "duplicate Stripe event id (same event replayed) -> not reprocessed (StripeWebhookEvent idempotency)",
  ];
  const actualStateTransitionEvidence = lifecycleEventCoverage
    .filter((c) => c.code !== "UNSIGNED_WEBHOOK_REJECTION_UNIT_TESTED")
    .map((c) => `${c.present ? "CONFIRMED" : "NOT CONFIRMED"}: ${c.label}`);

  const evidence: Omit<FylrBillingEvidencePackage, "evidenceId"> = {
    productId: "fylr",
    productName: "FYLR",
    productRepoPath: repo.repoPath,
    productHead: repo.head,
    productBranch: repo.branch,
    billingDomain: "subscription_lifecycle",
    billingProviderClassification: "stripe_subscription_billing",
    lifecycleEventCoverage,
    webhookSignatureProofRef:
      "app/billing.py:816-831 (_handle_stripe_webhook: stripe.Webhook.construct_event + SignatureVerificationError -> 400 Invalid signature); " +
      "tests/test_billing_lifecycle.py:_stripe_signed_payload (genuine Stripe-format HMAC-SHA256 't=<ts>,v1=<sig>' signature posted to the real /billing/webhook route); " +
      "tests/test_webhook_signature_rejection.py (fylr commit aecb6bc4aec2baf505557a13459cc116fcde514d — missing/empty/malformed Stripe-Signature header, wrong-secret signature, and tampered-payload-after-signing all asserted 400 Invalid signature with no DB side effects, against the real, unmocked stripe.Webhook.construct_event verification path on both /billing/webhook and the legacy /api/webhooks/stripe alias)",
    testProofRefs: testRun.testNames,
    commandEvidenceRefs: [testRun.command, `exitCode=${testRun.exitCode}`, `${testRun.passed} passed, ${testRun.failed} failed`],
    expectedStateTransitions,
    actualStateTransitionEvidence,
    liveStripeCallFlag: false,
    providerMutatedFlag: false,
    productMutatedFlag: false,
    rejectionFindings,
    verdict,
    generatedAt: new Date().toISOString(),
  };

  const artifact = await retainArtifact({
    kind: EVIDENCE_ARTIFACT_KIND,
    content: evidence,
    contentType: "application/json",
    retentionClass: "RELEASE",
    producer: "fylr-billing-bridge",
    source: "fylr-loader",
    projectId: "fylr",
  });

  return { ...evidence, evidenceId: artifact.id };
}
