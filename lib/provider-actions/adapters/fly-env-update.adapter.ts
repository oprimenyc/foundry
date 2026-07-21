import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/** Fly.io deployment environment/secret update advisory (Phase 2). Never calls the Fly API/CLI. */
export class FlyEnvUpdateAdapter implements ProviderActionAdapter {
  readonly adapterId = "fly-env-update-advisory";
  readonly providerType = "fly" as const;
  readonly actionType = "update_deployment_env_var" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes("fly-cli");
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Update the Fly.io secret/environment variable(s) for "${request.targetDescription}" in the ${request.targetEnvironment} app via \`fly secrets set\`.`,
      requiredCredentials: ["Fly.io app access (flyctl authenticated) with permission to set secrets"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["The Fly machine(s) restart and report healthy with the updated secret/variable applied."],
      rollbackSteps: ["Re-set the previous value via `fly secrets set` and allow the machine(s) to restart if the update causes a regression."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : "Fly CLI (flyctl) access is not confirmed available",
    };
  }
}
