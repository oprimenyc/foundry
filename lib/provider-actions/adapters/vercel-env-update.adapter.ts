import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/** Vercel deployment environment variable update advisory (Phase 2). Never calls the Vercel API/CLI. */
export class VercelEnvUpdateAdapter implements ProviderActionAdapter {
  readonly adapterId = "vercel-env-update-advisory";
  readonly providerType = "vercel" as const;
  readonly actionType = "update_deployment_env_var" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes("vercel-cli");
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Update the Vercel environment variable(s) for "${request.targetDescription}" in the ${request.targetEnvironment} environment via the Vercel dashboard/CLI, then redeploy so it takes effect.`,
      requiredCredentials: ["Vercel project access with permission to edit environment variables"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["A fresh Vercel deployment reports the updated variable applied and the app starts healthy."],
      rollbackSteps: ["Revert the environment variable(s) to their previous value in the Vercel dashboard and redeploy if the update causes a regression."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : "Vercel CLI/dashboard access is not confirmed available in this environment",
    };
  }
}
