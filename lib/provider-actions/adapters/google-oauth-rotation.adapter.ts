import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/** Google OAuth client secret rotation advisory (Phase 2). Never calls Google Cloud Console APIs. */
export class GoogleOAuthRotationAdapter implements ProviderActionAdapter {
  readonly adapterId = "google-oauth-rotation-advisory";
  readonly providerType = "google_oauth" as const;
  readonly actionType = "rotate_credential" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes("google-cloud-console-access");
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Regenerate the OAuth client secret for "${request.targetDescription}" in Google Cloud Console -> APIs & Services -> Credentials. Regeneration retires the prior secret automatically.`,
      requiredCredentials: ["Google Cloud Console project owner/editor access to the affected OAuth client"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["The OAuth sign-in flow succeeds end-to-end with the new client secret in every environment."],
      rollbackSteps: ["Google Cloud Console allows reverting only if the old secret has not yet been retired — otherwise regenerate again and redeploy."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : "Google Cloud Console project access is not confirmed available",
    };
  }
}
