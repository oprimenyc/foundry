import type { RemediationAdvisory, RemediationPlan, SecretExposureFinding } from "../types";
import type { SecretRemediationAdapter } from "./types";

/** Google OAuth client secret remediation advisory (Task 4). Never calls the Google Cloud API. */
export class GoogleOAuthRemediationAdapter implements SecretRemediationAdapter {
  readonly adapterId = "google-oauth-remediation-advisory";
  readonly provider = "google" as const;

  appliesTo(finding: SecretExposureFinding): boolean {
    return finding.secretCategory === "google_oauth_client_secret";
  }

  advise(finding: SecretExposureFinding, plan: RemediationPlan): RemediationAdvisory {
    return {
      adapterId: this.adapterId,
      provider: this.provider,
      action: "regenerate_oauth_client_secret",
      wouldAct: finding.rotationRequired,
      blocked: true,
      requiredApproval: plan.humanApprovalGates.filter((g) => g.reason === "live_provider_credential_rotation").map((g) => g.reason),
      requiredCredentials: ["Google Cloud Console project owner/editor access to the affected OAuth 2.0 Client ID"],
      verificationRequirement: "OAuth sign-in flow succeeds end-to-end with the new client secret in every environment.",
      evidenceRefs: plan.evidenceRequirements,
      noRealMutationConfirmed: true,
    };
  }
}
