import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/** Railway deployment environment variable update advisory (Phase 2). Never calls the Railway API/CLI. */
export class RailwayEnvUpdateAdapter implements ProviderActionAdapter {
  readonly adapterId = "railway-env-update-advisory";
  readonly providerType = "railway" as const;
  readonly actionType = "update_deployment_env_var" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes("railway-cli");
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Update the Railway environment variable(s) for "${request.targetDescription}" in the ${request.targetEnvironment} environment via the Railway dashboard/CLI.`,
      requiredCredentials: ["Railway project access with permission to edit environment variables"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["The Railway service restarts and reports healthy with the updated variable(s) applied."],
      rollbackSteps: ["Revert the environment variable(s) to their previous value in the Railway dashboard and trigger a redeploy if the update causes a regression."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : "Railway CLI/dashboard access is not confirmed available",
    };
  }
}
