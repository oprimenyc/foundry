import type { SecretExposureFindingInput } from "../types";

/**
 * vITALCore fixture cases (Task 5), authored directly from the read-only
 * containment doc in
 * `C:\Users\jp718\OneDrive\Desktop\_SORTED\Active_Projects\vitalcore`
 * (see FOUNDRY_SECRET_REMEDIATION_CURRENT_TRUTH.md for the full source).
 * The tracked `.env` file itself is one finding; the three named secret
 * categories it carried are three further findings, since each requires its
 * own category-specific remediation plan and provider classification. No
 * secret value is reproduced — only the variable *names* the source doc
 * itself already disclosed.
 */

const SOURCE_REF = "repo HEAD f880dda76923229b8cb24ea2b4ea5fb9869a53dd, branch repositioning-batch-3 (VITALCORE_ENV_CONTAINMENT_CURRENT_TRUTH.md) — .env tracked across 4 commits (2026-07-02 through 2026-07-04), already present on origin";

/** The tracked .env file itself — index fixed via `git rm --cached`, history exposure (already pushed) remains. */
export const VITALCORE_TRACKED_ENV_FIXTURE: SecretExposureFindingInput = {
  project: "vitalcore",
  filePath: ".env",
  sourceReference: SOURCE_REF,
  secretCategory: "generic_env_secret",
  exposureLocation: "current_tracked_file",
  severity: "critical",
  containmentStatus: "contained",
  rotationRequired: true,
  historyRewriteRequired: "required",
  deploymentEnvUpdateRequired: true,
  notes: "git rm --cached .env removed it from the current index; the same content is already on origin/repositioning-batch-3 across 4 historical commits, so history exposure is live on the remote, not just local.",
};

export const VITALCORE_NEXTAUTH_SECRET_FIXTURE: SecretExposureFindingInput = {
  project: "vitalcore",
  filePath: ".env",
  sourceReference: SOURCE_REF,
  secretCategory: "nextauth_secret",
  exposureLocation: "git_history",
  severity: "critical",
  containmentStatus: "partially_contained",
  rotationRequired: true,
  historyRewriteRequired: "required",
  deploymentEnvUpdateRequired: true,
  notes: "NEXTAUTH_SECRET variable name confirmed present in the tracked .env; value never read. Rotation invalidates all existing sessions by design.",
};

export const VITALCORE_GOOGLE_CLIENT_SECRET_FIXTURE: SecretExposureFindingInput = {
  project: "vitalcore",
  filePath: ".env",
  sourceReference: SOURCE_REF,
  secretCategory: "google_oauth_client_secret",
  exposureLocation: "git_history",
  severity: "critical",
  containmentStatus: "partially_contained",
  rotationRequired: true,
  historyRewriteRequired: "required",
  deploymentEnvUpdateRequired: true,
  notes: "GOOGLE_CLIENT_SECRET variable name confirmed present in the tracked .env; value never read. Requires regeneration in Google Cloud Console.",
};

export const VITALCORE_DATABASE_URL_FIXTURE: SecretExposureFindingInput = {
  project: "vitalcore",
  filePath: ".env",
  sourceReference: SOURCE_REF,
  secretCategory: "database_url",
  exposureLocation: "git_history",
  severity: "critical",
  containmentStatus: "partially_contained",
  rotationRequired: true,
  historyRewriteRequired: "required",
  deploymentEnvUpdateRequired: true,
  notes: "DATABASE_URL variable name confirmed present in the tracked .env; value never read.",
};

export function loadVitalcoreFixtures(): SecretExposureFindingInput[] {
  return [
    VITALCORE_TRACKED_ENV_FIXTURE,
    VITALCORE_NEXTAUTH_SECRET_FIXTURE,
    VITALCORE_GOOGLE_CLIENT_SECRET_FIXTURE,
    VITALCORE_DATABASE_URL_FIXTURE,
  ];
}
