import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/** GitHub PAT revocation advisory (Phase 2). Never calls the GitHub API. */
export class GitHubPatRevocationAdapter implements ProviderActionAdapter {
  readonly adapterId = "github-pat-revocation-advisory";
  readonly providerType = "github" as const;
  readonly actionType = "revoke_credential" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes("github-admin-access");
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Revoke the personal access token for "${request.targetDescription}" and, if still needed, reissue a replacement scoped to the minimum required permissions.`,
      requiredCredentials: ["GitHub account/org admin access with permission to revoke and reissue personal access tokens"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["Old token returns 401/403 on the GitHub API.", "Git operations succeed with the new credential-manager-based auth, if a replacement was issued."],
      rollbackSteps: ["There is no safe rollback to a revoked token — if a replacement is needed, issue a new one; never attempt to un-revoke."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : "GitHub org/account admin access with token-revocation permission is not confirmed available",
    };
  }
}
