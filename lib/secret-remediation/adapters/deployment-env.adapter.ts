import type { RemediationAdvisory, RemediationPlan, SecretExposureFinding } from "../types";
import type { SecretRemediationAdapter } from "./types";

/** Deployment environment update advisory (Task 4). Never writes to Railway/Vercel/etc. */
export class DeploymentEnvUpdateAdapter implements SecretRemediationAdapter {
  readonly adapterId = "deployment-env-update-advisory";
  readonly provider = "deployment-env" as const;

  appliesTo(finding: SecretExposureFinding): boolean {
    return finding.deploymentEnvUpdateRequired;
  }

  advise(finding: SecretExposureFinding, plan: RemediationPlan): RemediationAdvisory {
    return {
      adapterId: this.adapterId,
      provider: this.provider,
      action: "update_deployment_environment_variable",
      wouldAct: finding.deploymentEnvUpdateRequired,
      blocked: true,
      requiredApproval: plan.humanApprovalGates.filter((g) => g.reason === "deployment_env_mutation").map((g) => g.reason),
      requiredCredentials: ["Deployment platform (Railway/Vercel/etc.) project access with permission to edit environment variables"],
      verificationRequirement: "Every deployment environment referencing the exposed value reflects the rotated value and the app starts healthy.",
      evidenceRefs: plan.evidenceRequirements,
      noRealMutationConfirmed: true,
    };
  }
}
