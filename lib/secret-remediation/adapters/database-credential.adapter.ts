import type { RemediationAdvisory, RemediationPlan, SecretExposureFinding } from "../types";
import type { SecretRemediationAdapter } from "./types";

/** Database credential (Postgres/Supabase/Neon) remediation advisory (Task 4). Never calls a provider API. */
export class DatabaseCredentialRemediationAdapter implements SecretRemediationAdapter {
  readonly adapterId = "database-credential-remediation-advisory";
  readonly provider = "database" as const;

  appliesTo(finding: SecretExposureFinding): boolean {
    return finding.secretCategory === "database_url";
  }

  advise(finding: SecretExposureFinding, plan: RemediationPlan): RemediationAdvisory {
    return {
      adapterId: this.adapterId,
      provider: this.provider,
      action: "rotate_database_connection_string",
      wouldAct: finding.rotationRequired,
      blocked: true,
      requiredApproval: plan.humanApprovalGates.filter((g) => g.reason === "live_provider_credential_rotation" || g.reason === "credential_revocation").map((g) => g.reason),
      requiredCredentials: ["Database provider console access (Neon/Supabase/RDS) with permission to rotate credentials"],
      verificationRequirement: "Application connects with the new connection string in every environment; the old connection string no longer authenticates.",
      evidenceRefs: plan.evidenceRequirements,
      noRealMutationConfirmed: true,
    };
  }
}
