import { GitHubPatRemediationAdapter } from "./github-pat.adapter";
import { DatabaseCredentialRemediationAdapter } from "./database-credential.adapter";
import { GoogleOAuthRemediationAdapter } from "./google-oauth.adapter";
import { NextAuthSecretRemediationAdapter } from "./nextauth-secret.adapter";
import { DeploymentEnvUpdateAdapter } from "./deployment-env.adapter";
import { GitHistoryRewriteAdapter } from "./git-history.adapter";
import type { SecretRemediationAdapter } from "./types";
import type { RemediationAdvisory, RemediationPlan, SecretExposureFinding } from "../types";

const ADAPTERS: SecretRemediationAdapter[] = [
  new GitHubPatRemediationAdapter(),
  new DatabaseCredentialRemediationAdapter(),
  new GoogleOAuthRemediationAdapter(),
  new NextAuthSecretRemediationAdapter(),
  new DeploymentEnvUpdateAdapter(),
  new GitHistoryRewriteAdapter(),
];

/** Runs every adapter that applies to this finding. Always dry-run; see adapters/types.ts. */
export function runApplicableAdapters(finding: SecretExposureFinding, plan: RemediationPlan): RemediationAdvisory[] {
  return ADAPTERS.filter((adapter) => adapter.appliesTo(finding)).map((adapter) => adapter.advise(finding, plan));
}

export function listRemediationAdapters(): SecretRemediationAdapter[] {
  return ADAPTERS;
}
