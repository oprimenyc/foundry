import { newId } from "./ids";
import type {
  RemediationPlan,
  RemediationPlanGateRequirement,
  SecretExposureFinding,
} from "./types";

/**
 * Remediation plan engine (Task 2). Pure function: category + exposure
 * location + containment/history state in, a fully-populated plan out. No
 * network calls, no provider SDKs — the plan is advice, not execution.
 */

interface CategoryTemplate {
  immediateContainmentSteps: string[];
  providerRotationSteps: string[];
  revocationSteps: string[];
  verificationSteps: string[];
  rollbackPlan: string[];
  requiredCredentialsNote: string;
}

const CATEGORY_TEMPLATES: Record<SecretExposureFinding["secretCategory"], CategoryTemplate> = {
  github_pat: {
    immediateContainmentSteps: [
      "Strip the embedded credential from the git remote URL / local git config so it is no longer readable from disk.",
      "Confirm no other local clone, CI config, or script on this or any other machine still embeds the same token.",
    ],
    providerRotationSteps: [
      "Generate a replacement GitHub token only if one is still needed, scoped to the minimum required permissions, and store it via a credential manager — never in a remote URL.",
    ],
    revocationSteps: [
      "Revoke/delete the exposed personal access token in GitHub → Settings → Developer settings → Personal access tokens.",
      "Review GitHub's security/audit log and the token's last-used metadata for any activity attributable to it since creation.",
    ],
    verificationSteps: [
      "Confirm the revoked token now returns 401/403 on the GitHub API.",
      "Confirm ordinary git operations succeed using the credential-manager-based auth (no token embedded in config).",
    ],
    rollbackPlan: [
      "If the new auth setup breaks a workflow, fall back to interactive credential prompts temporarily — never re-embed a token in the remote URL as a shortcut.",
    ],
    requiredCredentialsNote: "a GitHub account/org admin with permission to revoke and reissue personal access tokens",
  },
  database_url: {
    immediateContainmentSteps: [
      "Confirm the current .env (or equivalent) is untracked by git and covered by .gitignore going forward.",
    ],
    providerRotationSteps: [
      "Rotate the database password/connection string from the provider's own dashboard (Neon, Supabase, RDS console, etc.) — never generate or apply rotation from application code.",
    ],
    revocationSteps: [
      "Invalidate the previously exposed connection string at the provider so the old credential can no longer authenticate once the new one is confirmed live.",
    ],
    verificationSteps: [
      "Confirm the application connects successfully using the newly rotated connection string in every environment.",
      "Confirm the old connection string no longer authenticates against the database.",
    ],
    rollbackPlan: [
      "Keep the previous (now-revoked) connection string documented for emergency rollback only until the new one is verified stable in production, then discard it.",
    ],
    requiredCredentialsNote: "database provider console access (Neon/Supabase/RDS) with permission to rotate credentials",
  },
  google_oauth_client_secret: {
    immediateContainmentSteps: [
      "Confirm the file/location carrying the client secret is untracked by git and covered by .gitignore going forward.",
    ],
    providerRotationSteps: [
      "Regenerate the OAuth client secret in Google Cloud Console → APIs & Services → Credentials for the affected OAuth 2.0 Client ID.",
    ],
    revocationSteps: [
      "Confirm the old client secret is invalidated as soon as the new one is generated (Google Cloud Console regeneration retires the prior secret).",
    ],
    verificationSteps: [
      "Confirm the OAuth sign-in flow succeeds end-to-end with the new client secret in every environment.",
    ],
    rollbackPlan: [
      "If sign-in breaks after rotation, Google Cloud Console allows reverting to a still-valid secret only if the old one has not yet been retired — otherwise regenerate again and redeploy.",
    ],
    requiredCredentialsNote: "Google Cloud Console project owner/editor access to the affected OAuth client",
  },
  nextauth_secret: {
    immediateContainmentSteps: [
      "Confirm the file/location carrying the secret is untracked by git and covered by .gitignore going forward.",
    ],
    providerRotationSteps: [
      "Generate a new random secret (e.g. `openssl rand -base64 32`) to replace the exposed NEXTAUTH_SECRET.",
    ],
    revocationSteps: [
      "Rotating NEXTAUTH_SECRET invalidates every existing session token signed with the old secret — confirm this is the intended, expected effect (forced re-authentication) rather than a bug.",
    ],
    verificationSteps: [
      "Confirm existing sessions are invalidated as expected and a fresh sign-in succeeds after rotation.",
    ],
    rollbackPlan: [
      "There is no safe rollback to the exposed secret — if rotation causes unexpected breakage, fix forward with another newly generated secret, never revert to the compromised value.",
    ],
    requiredCredentialsNote: "deployment environment access to update the app's own NEXTAUTH_SECRET variable",
  },
  generic_env_secret: {
    immediateContainmentSteps: [
      "Confirm the file/location carrying the secret is untracked by git and covered by .gitignore going forward.",
    ],
    providerRotationSteps: [
      "Rotate the exposed value at its owning system/provider console — identify the correct owner before assuming any specific rotation mechanism.",
    ],
    revocationSteps: ["Invalidate the previously exposed value once its owning system is identified and a replacement is issued."],
    verificationSteps: ["Confirm the application functions correctly with the replacement value and the old value no longer works."],
    rollbackPlan: ["Keep the previous value documented for emergency rollback only until the replacement is verified stable, then discard it."],
    requiredCredentialsNote: "access to whichever system issued the exposed value",
  },
};

function locationSteps(finding: SecretExposureFinding): { containment: string[]; rollback: string[] } {
  const containment: string[] = [];
  const rollback: string[] = [];
  switch (finding.exposureLocation) {
    case "current_tracked_file":
      containment.push(`Run \`git rm --cached ${finding.filePath}\` to stop future commits from including it (the file stays on disk).`);
      break;
    case "local_git_config":
      containment.push("Rewrite the local git remote URL/config to remove the embedded credential.");
      break;
    case "deployment_env":
      containment.push("Confirm the deployment environment variable store is not itself readable by unauthorized parties.");
      break;
    case "git_history":
    case "unknown":
      break;
  }
  if (finding.historyRewriteRequired !== "not_applicable") {
    rollback.push(
      "A history rewrite (git filter-repo or BFG Repo-Cleaner) followed by a force-push rewrites every downstream commit hash and breaks existing clones/forks/PRs — every collaborator must re-clone or hard-reset. This is why it requires its own explicit approval gate, separate from rotation."
    );
  }
  return { containment, rollback };
}

function gateRequirements(finding: SecretExposureFinding): RemediationPlanGateRequirement[] {
  const gates: RemediationPlanGateRequirement[] = [];
  if (finding.rotationRequired) {
    gates.push({
      reason: "live_provider_credential_rotation",
      riskLevel: finding.severity === "critical" ? "critical" : "high",
      requiredAction: `Approve live rotation of the exposed ${finding.secretCategory} at its provider.`,
    });
    gates.push({
      reason: "credential_revocation",
      riskLevel: finding.severity === "critical" ? "critical" : "high",
      requiredAction: `Approve revocation of the previously exposed ${finding.secretCategory} value.`,
    });
  }
  if (finding.deploymentEnvUpdateRequired) {
    gates.push({
      reason: "deployment_env_mutation",
      riskLevel: "high",
      requiredAction: "Approve updating the deployed environment variable(s) with the rotated value.",
    });
    if (finding.secretCategory === "nextauth_secret") {
      gates.push({
        reason: "production_restart_redeploy",
        riskLevel: "high",
        requiredAction: "Approve restarting/redeploying the running service so it picks up the rotated secret.",
      });
    }
  }
  if (finding.historyRewriteRequired === "required" || finding.historyRewriteRequired === "optional") {
    gates.push({
      reason: "git_history_rewrite",
      riskLevel: "critical",
      requiredAction: "Decide and approve whether git history must be rewritten to remove the exposed value entirely.",
    });
    gates.push({
      reason: "force_push",
      riskLevel: "critical",
      requiredAction: "Approve the force-push required after any history rewrite, understanding it breaks existing clones/forks/PRs.",
    });
  }
  return gates;
}

export function generateRemediationPlan(finding: SecretExposureFinding): RemediationPlan {
  const template = CATEGORY_TEMPLATES[finding.secretCategory];
  const { containment: locationContainment, rollback: locationRollback } = locationSteps(finding);

  const deploymentEnvUpdateSteps = finding.deploymentEnvUpdateRequired
    ? [`Update every deployment environment (e.g. hosting/CI env var store) referencing the exposed ${finding.secretCategory} with the rotated value.`]
    : [];

  const remainingOwnerActions: string[] = [];
  if (finding.rotationRequired) remainingOwnerActions.push(`Rotate the exposed ${finding.secretCategory} at its provider — Foundry cannot do this.`);
  if (finding.deploymentEnvUpdateRequired) remainingOwnerActions.push("Update the rotated value in every deployment environment.");
  if (finding.historyRewriteRequired === "required") {
    remainingOwnerActions.push("A history rewrite is required (already-pushed exposure) — decide and coordinate a git filter-repo/BFG pass plus force-push.");
  } else if (finding.historyRewriteRequired === "optional") {
    remainingOwnerActions.push("Decide rotate-and-contain vs. a full history rewrite; rotation is mandatory either way.");
  }
  if (finding.containmentStatus !== "contained") {
    remainingOwnerActions.push("Immediate containment is not yet complete — close the local exposure vector before anything else.");
  }

  return {
    id: newId("remplan"),
    findingId: finding.id,
    immediateContainmentSteps: [...locationContainment, ...template.immediateContainmentSteps],
    providerRotationSteps: finding.rotationRequired ? template.providerRotationSteps : [],
    deploymentEnvUpdateSteps,
    verificationSteps: template.verificationSteps,
    revocationSteps: finding.rotationRequired ? template.revocationSteps : [],
    rollbackPlan: [...template.rollbackPlan, ...locationRollback],
    humanApprovalGates: gateRequirements(finding),
    evidenceRequirements: [
      "Metadata-only confirmation of rotation/revocation (timestamp, provider, actor — never the credential value).",
      "Updated tracked-file/config diff showing the exposure vector closed.",
      `Note: ${template.requiredCredentialsNote}.`,
    ],
    remainingOwnerActions,
    generatedAt: new Date().toISOString(),
  };
}
