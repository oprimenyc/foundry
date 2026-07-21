import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionProviderType, ProviderActionRequest, ProviderActionType } from "../types";
import type { ProviderActionAdapter } from "./types";

/**
 * Service restart/redeploy advisory (Phase 2). Provider-parameterized: one
 * class, instantiated per (providerType, actionType) pair in registry.ts, so
 * Railway/Fly/Vercel each get their own restart_service and redeploy_service
 * advisory without duplicating this logic six times. Never calls a live
 * restart/redeploy API.
 */
export class ServiceRestartRedeployAdapter implements ProviderActionAdapter {
  readonly adapterId: string;
  readonly providerType: ProviderActionProviderType;
  readonly actionType: ProviderActionType;

  constructor(providerType: "railway" | "fly" | "vercel", actionType: "restart_service" | "redeploy_service") {
    this.providerType = providerType;
    this.actionType = actionType;
    this.adapterId = `${providerType}-${actionType.replace(/_/g, "-")}-advisory`;
  }

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteKey = `${this.providerType}-cli`;
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes(prerequisiteKey);
    const verb = this.actionType === "restart_service" ? "restart" : "redeploy";
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `${verb === "restart" ? "Restart" : "Trigger a fresh deploy of"} "${request.targetDescription}" on ${this.providerType} in the ${request.targetEnvironment} environment.`,
      requiredCredentials: [`${this.providerType} project access with permission to ${verb} the service`],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: [`The service reports healthy (readiness/liveness check passes) within a reasonable window after the ${verb}.`],
      rollbackSteps: [`Roll back to the previously running deployment/version on ${this.providerType} if the ${verb} introduces a regression.`],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : `${this.providerType} CLI/dashboard access is not confirmed available`,
    };
  }
}
