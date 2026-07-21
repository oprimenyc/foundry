import type { RemediationAdvisory, RemediationPlan, SecretExposureFinding } from "../types";
import type { SecretRemediationAdapter } from "./types";

/** NextAuth secret regeneration advisory (Task 4). Never touches a running deployment. */
export class NextAuthSecretRemediationAdapter implements SecretRemediationAdapter {
  readonly adapterId = "nextauth-secret-remediation-advisory";
  readonly provider = "nextauth" as const;

  appliesTo(finding: SecretExposureFinding): boolean {
    return finding.secretCategory === "nextauth_secret";
  }

  advise(finding: SecretExposureFinding, plan: RemediationPlan): RemediationAdvisory {
    return {
      adapterId: this.adapterId,
      provider: this.provider,
      action: "regenerate_nextauth_secret",
      wouldAct: finding.rotationRequired,
      blocked: true,
      requiredApproval: plan.humanApprovalGates.filter((g) => g.reason === "deployment_env_mutation" || g.reason === "production_restart_redeploy").map((g) => g.reason),
      requiredCredentials: ["Deployment environment access to update the app's own NEXTAUTH_SECRET variable and restart the service"],
      verificationRequirement: "Existing sessions are invalidated as expected and a fresh sign-in succeeds after rotation and restart.",
      evidenceRefs: plan.evidenceRequirements,
      noRealMutationConfirmed: true,
    };
  }
}
