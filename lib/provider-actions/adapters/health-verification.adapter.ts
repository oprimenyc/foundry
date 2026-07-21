import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionProviderType, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/**
 * Service health verification advisory (Phase 2). Provider-parameterized,
 * same reasoning as service-restart-redeploy.adapter.ts. Non-mutating: this
 * is the one action type that never requires an approval gate (see
 * policy.ts's NON_MUTATING_ACTION_TYPES) — it only ever *checks*, never
 * *changes*, provider state, and it never makes a live HTTP call either;
 * "dry-run" here means the check plan itself, not a real health probe.
 */
export class HealthVerificationAdapter implements ProviderActionAdapter {
  readonly adapterId: string;
  readonly providerType: ProviderActionProviderType;
  readonly actionType = "verify_service_health" as const;

  constructor(providerType: "railway" | "fly" | "vercel") {
    this.providerType = providerType;
    this.adapterId = `${providerType}-health-verification-advisory`;
  }

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes(`${this.providerType}-cli`);
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Check the readiness/liveness/health endpoint(s) for "${request.targetDescription}" on ${this.providerType} in the ${request.targetEnvironment} environment. Read-only: verification never mutates provider state.`,
      requiredCredentials: [`${this.providerType} project access with permission to read deployment/service status`],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["The service's health endpoint returns a healthy status code within its expected response time."],
      rollbackSteps: ["Not applicable — a read-only health check has nothing to roll back."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : `${this.providerType} CLI/dashboard access is not confirmed available`,
    };
  }
}
