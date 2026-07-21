import { GitHubPatRevocationAdapter } from "./github-pat-revocation.adapter";
import { DatabaseCredentialRotationAdapter } from "./database-credential-rotation.adapter";
import { GoogleOAuthRotationAdapter } from "./google-oauth-rotation.adapter";
import { NextAuthSecretRegenerationAdapter } from "./nextauth-secret-regeneration.adapter";
import { RailwayEnvUpdateAdapter } from "./railway-env-update.adapter";
import { FlyEnvUpdateAdapter } from "./fly-env-update.adapter";
import { VercelEnvUpdateAdapter } from "./vercel-env-update.adapter";
import { ServiceRestartRedeployAdapter } from "./service-restart-redeploy.adapter";
import { HealthVerificationAdapter } from "./health-verification.adapter";
import { DnsAdvisoryAdapter } from "./dns-advisory.adapter";
import { GitHistoryRewriteAdvisoryAdapter } from "./git-history-rewrite-advisory.adapter";
import type { ProviderActionAdapter } from "./types";
import type { ProviderActionProviderType, ProviderActionType } from "../types";

const REDEPLOY_PROVIDERS = ["railway", "fly", "vercel"] as const;

/**
 * Every provider action adapter this module ships (Phase 2's 11 named
 * adapters — restart/redeploy and health-verification are provider-
 * parameterized, so they register one instance per Railway/Fly/Vercel
 * rather than needing 6 separate files). Matched by exact
 * (providerType, actionType) pair — one adapter per pair, never "run every
 * applicable adapter" (unlike lib/secret-remediation's registry, where
 * multiple advisories can legitimately apply to one finding): a provider
 * action request always targets exactly one specific action.
 */
const ADAPTERS: ProviderActionAdapter[] = [
  new GitHubPatRevocationAdapter(),
  new DatabaseCredentialRotationAdapter(),
  new GoogleOAuthRotationAdapter(),
  new NextAuthSecretRegenerationAdapter(),
  new RailwayEnvUpdateAdapter(),
  new FlyEnvUpdateAdapter(),
  new VercelEnvUpdateAdapter(),
  new DnsAdvisoryAdapter(),
  new GitHistoryRewriteAdvisoryAdapter(),
  ...REDEPLOY_PROVIDERS.flatMap((provider) => [
    new ServiceRestartRedeployAdapter(provider, "restart_service"),
    new ServiceRestartRedeployAdapter(provider, "redeploy_service"),
  ]),
  ...REDEPLOY_PROVIDERS.map((provider) => new HealthVerificationAdapter(provider)),
];

export function resolveProviderActionAdapter(providerType: ProviderActionProviderType, actionType: ProviderActionType): ProviderActionAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.providerType === providerType && adapter.actionType === actionType);
}

export function listProviderActionAdapters(): ProviderActionAdapter[] {
  return ADAPTERS;
}
