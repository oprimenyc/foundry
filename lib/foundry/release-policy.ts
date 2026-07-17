/**
 * Release policy engine (Mission 9).
 *
 * Deterministic, explainable promotion decisions. A deployment NEVER promotes
 * merely because a command exited zero — promotion is a policy decision over
 * the full evidence surface. Fail-closed: any missing signal blocks or forces
 * manual review rather than defaulting to allow.
 */

export type ReleaseEnvironment = "test" | "preview" | "staging" | "production";

export type SignalStatus = "passed" | "failed" | "unknown";

export interface ReleaseContext {
  targetEnvironment: ReleaseEnvironment;
  /** Risk of the change being promoted. */
  riskLevel: "low" | "moderate" | "high" | "critical";
  testStatus: SignalStatus;
  buildStatus: SignalStatus;
  runtimeStatus: SignalStatus;
  securityStatus: SignalStatus;
  /** Independent verification (E.V.E. or Foundry independent verifier). */
  verificationStatus: SignalStatus;
  /** Approvals already recorded for this promotion. */
  approvalsGranted: number;
  /** True only when every required artifact class has been retained. */
  artifactsComplete: boolean;
  /** True only when a concrete rollback plan/target exists. */
  rollbackReady: boolean;
  /** Whether the current time is within an allowed change window. */
  withinChangeWindow?: boolean;
  /** Provider/platform health for the target. */
  providerHealthy: SignalStatus;
}

export type PromotionDecisionOutcome =
  | "PROMOTION_ALLOWED"
  | "PROMOTION_ALLOWED_WITH_APPROVAL"
  | "PROMOTION_BLOCKED"
  | "MANUAL_REVIEW_REQUIRED";

export interface PromotionDecision {
  outcome: PromotionDecisionOutcome;
  requiredApprovals: number;
  blockingReasons: string[];
  warnings: string[];
  reasons: string[];
  policyVersion: string;
}

export const RELEASE_POLICY_VERSION = "foundry-release-policy@1";

/** Minimum approvals required by target environment + risk. */
function requiredApprovalsFor(env: ReleaseEnvironment, risk: ReleaseContext["riskLevel"]): number {
  if (env === "production") return risk === "critical" ? 2 : 1;
  if (env === "staging") return risk === "critical" || risk === "high" ? 1 : 0;
  return 0; // test / preview
}

export function evaluatePromotion(ctx: ReleaseContext): PromotionDecision {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const reasons: string[] = [];

  // Hard blocks: any explicitly failed gate blocks promotion outright.
  const failGate = (name: string, status: SignalStatus) => {
    if (status === "failed") blockingReasons.push(`${name} failed`);
  };
  failGate("tests", ctx.testStatus);
  failGate("build", ctx.buildStatus);
  failGate("runtime health", ctx.runtimeStatus);
  failGate("security", ctx.securityStatus);
  failGate("independent verification", ctx.verificationStatus);
  failGate("provider health", ctx.providerHealthy);

  if (!ctx.rollbackReady) blockingReasons.push("no rollback plan is ready");
  if (!ctx.artifactsComplete) blockingReasons.push("required release artifacts are incomplete");

  // Production change window is a hard gate when explicitly declared closed.
  if (ctx.targetEnvironment === "production" && ctx.withinChangeWindow === false) {
    blockingReasons.push("outside the permitted production change window");
  }

  const requiredApprovals = requiredApprovalsFor(ctx.targetEnvironment, ctx.riskLevel);

  // Unknown signals never pass silently — they force manual review (not block,
  // not allow), because "we don't know" is not "it's fine".
  const unknownSignals = (
    [
      ["tests", ctx.testStatus],
      ["build", ctx.buildStatus],
      ["runtime health", ctx.runtimeStatus],
      ["security", ctx.securityStatus],
      ["independent verification", ctx.verificationStatus],
      ["provider health", ctx.providerHealthy],
    ] as Array<[string, SignalStatus]>
  )
    .filter(([, status]) => status === "unknown")
    .map(([name]) => name);

  if (blockingReasons.length > 0) {
    return {
      outcome: "PROMOTION_BLOCKED",
      requiredApprovals,
      blockingReasons,
      warnings,
      reasons: [`blocked by ${blockingReasons.length} failed gate(s)`],
      policyVersion: RELEASE_POLICY_VERSION,
    };
  }

  if (unknownSignals.length > 0) {
    return {
      outcome: "MANUAL_REVIEW_REQUIRED",
      requiredApprovals: Math.max(requiredApprovals, 1),
      blockingReasons,
      warnings: [`unknown signal(s): ${unknownSignals.join(", ")}`],
      reasons: ["one or more required signals are unknown — human review required before promotion"],
      policyVersion: RELEASE_POLICY_VERSION,
    };
  }

  // Critical risk always requires manual review regardless of green signals.
  if (ctx.riskLevel === "critical") {
    reasons.push("critical-risk change requires explicit human sign-off");
    return {
      outcome:
        ctx.approvalsGranted >= requiredApprovals ? "PROMOTION_ALLOWED_WITH_APPROVAL" : "MANUAL_REVIEW_REQUIRED",
      requiredApprovals,
      blockingReasons,
      warnings,
      reasons,
      policyVersion: RELEASE_POLICY_VERSION,
    };
  }

  reasons.push("all required gates passed");
  if (requiredApprovals === 0) {
    return {
      outcome: "PROMOTION_ALLOWED",
      requiredApprovals,
      blockingReasons,
      warnings,
      reasons,
      policyVersion: RELEASE_POLICY_VERSION,
    };
  }

  if (ctx.approvalsGranted >= requiredApprovals) {
    reasons.push(`${ctx.approvalsGranted}/${requiredApprovals} approvals recorded`);
    return {
      outcome: "PROMOTION_ALLOWED_WITH_APPROVAL",
      requiredApprovals,
      blockingReasons,
      warnings,
      reasons,
      policyVersion: RELEASE_POLICY_VERSION,
    };
  }

  return {
    outcome: "MANUAL_REVIEW_REQUIRED",
    requiredApprovals,
    blockingReasons,
    warnings,
    reasons: [`${ctx.approvalsGranted}/${requiredApprovals} required approvals recorded`],
    policyVersion: RELEASE_POLICY_VERSION,
  };
}
