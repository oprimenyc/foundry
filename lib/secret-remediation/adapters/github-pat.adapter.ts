import type { RemediationAdvisory, RemediationPlan, SecretExposureFinding } from "../types";
import type { SecretRemediationAdapter } from "./types";

/** GitHub PAT remediation advisory (Task 4). Never calls the GitHub API. */
export class GitHubPatRemediationAdapter implements SecretRemediationAdapter {
  readonly adapterId = "github-pat-remediation-advisory";
  readonly provider = "github" as const;

  appliesTo(finding: SecretExposureFinding): boolean {
    return finding.secretCategory === "github_pat";
  }

  advise(finding: SecretExposureFinding, plan: RemediationPlan): RemediationAdvisory {
    return {
      adapterId: this.adapterId,
      provider: this.provider,
      action: "revoke_and_reissue_personal_access_token",
      wouldAct: finding.rotationRequired,
      blocked: true,
      requiredApproval: plan.humanApprovalGates.filter((g) => g.reason === "live_provider_credential_rotation" || g.reason === "credential_revocation").map((g) => g.reason),
      requiredCredentials: ["GitHub account/org admin access with permission to revoke and reissue personal access tokens"],
      verificationRequirement: "Old token returns 401/403 on the GitHub API; git operations succeed with the new credential-manager-based auth.",
      evidenceRefs: plan.evidenceRequirements,
      noRealMutationConfirmed: true,
    };
  }
}
