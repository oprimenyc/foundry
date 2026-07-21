import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/** NextAuth secret regeneration advisory (Phase 2). Never writes a deployment environment variable. */
export class NextAuthSecretRegenerationAdapter implements ProviderActionAdapter {
  readonly adapterId = "nextauth-secret-regeneration-advisory";
  readonly providerType = "nextauth" as const;
  readonly actionType = "rotate_credential" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes("deployment-env-access");
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Generate a new random NEXTAUTH_SECRET for "${request.targetDescription}" (e.g. openssl rand -base64 32) and update every deployment environment referencing it — rotation alone invalidates sessions but does nothing until the deployment is also updated.`,
      requiredCredentials: ["Deployment environment access to update the app's own NEXTAUTH_SECRET variable in every environment"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["Existing sessions are invalidated as expected.", "A fresh sign-in succeeds after rotation and redeploy."],
      rollbackSteps: ["There is no safe rollback to the exposed/prior secret — fix forward with another newly generated secret if rotation causes breakage."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : "deployment environment access to update NEXTAUTH_SECRET is not confirmed available",
    };
  }
}
