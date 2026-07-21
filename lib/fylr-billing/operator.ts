import { buildFylrBillingEvidence } from "./evidence";
import type { FylrBillingEvidencePackage, FylrBillingVerdict } from "./types";

/**
 * Operator/query surface (mission Phase 6): what an operator needs to see
 * for the fylr billing evidence bridge without ever implying a live Stripe
 * call happened. Mirrors lib/amos-youtube/operator.ts.
 */
export interface FylrBillingBridgeOperatorReport {
  generatedAt: string;
  product: "fylr";
  billingDomain: "subscription_lifecycle";
  lifecycleEventsCovered: { total: number; present: number; missing: string[] };
  foundryEvidenceVerdict: FylrBillingVerdict;
  eveVerificationVerdict: "NOT_RUN_FROM_FOUNDRY";
  blockerWarningSummary: string[];
  liveStripeCallFlag: false;
  providerMutatedFlag: false;
  productMutatedFlag: false;
  evidenceRefs: string[];
  remainingOwnerActions: string[];
}

function remainingOwnerActions(evidence: FylrBillingEvidencePackage): string[] {
  if (evidence.rejectionFindings.length > 0) {
    return evidence.rejectionFindings.map((f) => `Resolve rejection finding "${f.code}": ${f.message}`);
  }
  return evidence.lifecycleEventCoverage.filter((c) => !c.present).map((c) => `Close coverage gap: ${c.label}`);
}

/**
 * Builds the operator report for fylr's billing evidence bridge.
 * `eveVerificationVerdict` is always "NOT_RUN_FROM_FOUNDRY" here — Foundry
 * never runs VERIDIAN's E.V.E. verifier itself; that verdict is only
 * available from VERIDIAN's own evidence/proofs/eve-fylr-billing-evidence.
 */
export async function getFylrBillingBridgeOperatorReport(
  options: Parameters<typeof buildFylrBillingEvidence>[0] = {},
): Promise<FylrBillingBridgeOperatorReport> {
  const evidence = await buildFylrBillingEvidence(options);
  const missing = evidence.lifecycleEventCoverage.filter((c) => !c.present).map((c) => c.label);

  return {
    generatedAt: new Date().toISOString(),
    product: "fylr",
    billingDomain: "subscription_lifecycle",
    lifecycleEventsCovered: { total: evidence.lifecycleEventCoverage.length, present: evidence.lifecycleEventCoverage.length - missing.length, missing },
    foundryEvidenceVerdict: evidence.verdict,
    eveVerificationVerdict: "NOT_RUN_FROM_FOUNDRY",
    blockerWarningSummary: [...evidence.rejectionFindings.map((f) => f.message), ...missing],
    liveStripeCallFlag: false,
    providerMutatedFlag: false,
    productMutatedFlag: false,
    evidenceRefs: [evidence.evidenceId],
    remainingOwnerActions: remainingOwnerActions(evidence),
  };
}
