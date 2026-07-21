import type { RemediationAdvisory, RemediationPlan, SecretExposureFinding } from "../types";

/**
 * Safe adapter boundary (Task 4). Every adapter here is dry-run/advisory
 * only: `advise()` is a pure, synchronous function that describes what a
 * live rotation/mutation/rewrite would require — it never makes an HTTP
 * call, never touches a provider SDK, and never accepts a live-mode escape
 * hatch (unlike lib/email-qa/adapters/resend-boundary.adapter.ts, which does
 * have one behind two explicit flags — deliberately NOT mirrored here, per
 * this mission's absolute "no real provider calls" constraint).
 */
export interface SecretRemediationAdapter {
  readonly adapterId: string;
  readonly provider: RemediationAdvisory["provider"];
  /** Whether this adapter applies to the given finding (category/location match). */
  appliesTo(finding: SecretExposureFinding): boolean;
  advise(finding: SecretExposureFinding, plan: RemediationPlan): RemediationAdvisory;
}
