// Loading the catalog is what populates the registry — selection without a
// populated registry would silently fail closed on every request.
import "./catalog";
import { universalRegistry } from "./registry";
import { credentialStatusFor } from "./credentials";
import { healthScore } from "./health";
import { estimateActionCost, exceedsMonthlyCap } from "./cost";
import { computeIntelligenceScore, openIncidents } from "./intelligence";
import { findReferencesForProvider } from "@/lib/vault/registry";
import { mocksExplicitlyAllowed } from "@/lib/foundry/providers";
import {
  DEFAULT_TENANT_POLICY,
  NoEligibleProviderError,
  normalizeCategory,
  type SelectionDecision,
  type SelectionInput,
  type SelectionRejection,
  type UniversalProvider,
} from "./types";

export const SELECTION_ENGINE_VERSION = "foundry-selection-engine@1";

/** Health scores below this are ineligible when an alternative exists. */
const MIN_HEALTH_SCORE = 0.25;

/**
 * Provider Selection Engine.
 *
 * The planner says "need <category>.<action>" — never a vendor name. This
 * engine picks the vendor from: tenant policy (blocked/allowed/preferred,
 * cost + latency caps) → credential readiness → health score → cost → latency.
 * Fails closed with every rejection reason when nothing is eligible.
 */
export function selectProvider(input: SelectionInput): SelectionDecision {
  const category = normalizeCategory(String(input.category));
  const policy = input.tenantPolicy ?? DEFAULT_TENANT_POLICY;
  const excluded = new Set(input.excludeProviders ?? []);
  const rejected: SelectionRejection[] = [];
  const eligible: UniversalProvider[] = [];

  for (const provider of universalRegistry.listProviders(category)) {
    const id = provider.provider;
    const manifest = provider.manifest;
    if (excluded.has(id)) {
      rejected.push({ providerId: id, reason: "excluded (already failed in this run)" });
      continue;
    }
    if (!manifest.supportedCapabilities.includes(input.action)) {
      rejected.push({ providerId: id, reason: `does not support action ${input.action}` });
      continue;
    }
    if (policy.blockedProviders?.includes(id)) {
      rejected.push({ providerId: id, reason: "blocked by tenant policy" });
      continue;
    }
    const allowed = policy.allowedProviders?.[category];
    if (allowed && !allowed.includes(id)) {
      rejected.push({ providerId: id, reason: "not in tenant allowed list" });
      continue;
    }
    if (exceedsMonthlyCap(manifest, policy.maxMonthlyCostUsd)) {
      rejected.push({ providerId: id, reason: `monthly floor exceeds tenant cap $${policy.maxMonthlyCostUsd}` });
      continue;
    }
    if (policy.maxLatencyMs !== undefined && manifest.estimatedLatencyMs > policy.maxLatencyMs) {
      rejected.push({ providerId: id, reason: `estimated latency ${manifest.estimatedLatencyMs}ms exceeds tenant cap` });
      continue;
    }
    // Credential availability. With a vault scope, secret REFERENCES answer
    // this (metadata only — values are never resolved during selection).
    // Without one, M2 env-presence behavior is preserved.
    const mockAllowed = process.env.NODE_ENV !== "production" || mocksExplicitlyAllowed();
    const vaultReferences = input.vaultScope ? findReferencesForProvider(id, input.vaultScope) : [];
    if (vaultReferences.length > 0) {
      const now = new Date().toISOString();
      const eligibleReference = vaultReferences.find(
        (reference) =>
          reference.status === "available" &&
          (!reference.expiresAt || reference.expiresAt > now) &&
          (reference.capabilities.length === 0 || reference.capabilities.includes(input.action))
      );
      if (!eligibleReference) {
        rejected.push({
          providerId: id,
          reason: `no eligible credential reference (${vaultReferences.map((r) => `${r.id}:${r.status}`).join(", ")})`,
        });
        continue;
      }
    } else {
      const credentials = credentialStatusFor(manifest);
      if (!credentials.satisfied && manifest.runtimeStatus === "live") {
        rejected.push({ providerId: id, reason: `missing credentials: ${credentials.missingReferences.join(", ")}` });
        continue;
      }
    }
    if (manifest.runtimeStatus === "mock" && !mockAllowed) {
      rejected.push({ providerId: id, reason: "mock provider disabled in production" });
      continue;
    }
    if (manifest.runtimeStatus === "unavailable") {
      rejected.push({ providerId: id, reason: "declared unavailable" });
      continue;
    }
    eligible.push(provider);
  }

  // Open critical incidents disqualify a provider when an alternative exists —
  // and are never silently ignored (recorded as rejections either way).
  const withIncidents = eligible.map((provider) => ({
    provider,
    criticalIncident: openIncidents(provider.provider).some((incident) => incident.severity === "critical"),
  }));
  const incidentFree = withIncidents.filter((entry) => !entry.criticalIncident);
  const incidentPool = incidentFree.length > 0 ? incidentFree : withIncidents;
  for (const entry of withIncidents) {
    if (!incidentPool.includes(entry)) {
      rejected.push({ providerId: entry.provider.provider, reason: "open critical incident" });
    }
  }

  // Health floor applies only when a healthier alternative exists — degraded
  // availability beats no availability (Constitution Art. X).
  const scored = incidentPool.map(({ provider }) => ({
    provider,
    score: healthScore(provider.provider),
    intelligence: computeIntelligenceScore(provider.provider, {
      capability: input.action,
      tenantId: policy.tenantId,
      policyEligible: true,
      credentialAvailable: true,
    }),
  }));
  const healthy = scored.filter((entry) => entry.score >= MIN_HEALTH_SCORE);
  const pool = healthy.length > 0 ? healthy : scored;
  for (const entry of scored) {
    if (!pool.includes(entry)) {
      rejected.push({ providerId: entry.provider.provider, reason: `health score ${entry.score.toFixed(2)} below floor` });
    }
  }

  if (pool.length === 0) throw new NoEligibleProviderError(category, input.action, rejected);

  const preferred = policy.preferredProviders?.[category];
  pool.sort((a, b) => {
    const aPreferred = a.provider.provider === preferred ? 1 : 0;
    const bPreferred = b.provider.provider === preferred ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    if (a.score !== b.score) return b.score - a.score;
    // Provider Intelligence: recorded reliability history (deterministic,
    // explainable). With no history every provider blends to the same neutral
    // prior, so pre-M3 ordering is unchanged.
    const aReliability = a.intelligence.components.historicalReliability * (1 - a.intelligence.components.incidentPenalty);
    const bReliability = b.intelligence.components.historicalReliability * (1 - b.intelligence.components.incidentPenalty);
    if (aReliability !== bReliability) return bReliability - aReliability;
    const aCost = estimateActionCost(a.provider.manifest).comparable;
    const bCost = estimateActionCost(b.provider.manifest).comparable;
    if (aCost !== bCost) return aCost - bCost;
    const aLatency = a.provider.manifest.estimatedLatencyMs;
    const bLatency = b.provider.manifest.estimatedLatencyMs;
    if (aLatency !== bLatency) return aLatency - bLatency;
    return a.provider.provider.localeCompare(b.provider.provider);
  });

  const winnerEntry = pool[0];
  const winner = winnerEntry.provider;
  const reasons = [
    winner.provider === preferred ? "tenant preferred provider" : undefined,
    `health score ${healthScore(winner.provider).toFixed(2)}`,
    `estimated cost $${winner.manifest.estimatedCost.amountPerAction}/action`,
    `estimated latency ${winner.manifest.estimatedLatencyMs}ms`,
    `runtime status ${winner.manifest.runtimeStatus}`,
    ...winnerEntry.intelligence.reasons,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    providerId: winner.provider,
    intelligence: {
      score: winnerEntry.intelligence.score,
      components: winnerEntry.intelligence.components as unknown as Record<string, number>,
      reasons: winnerEntry.intelligence.reasons,
      sampleSize: winnerEntry.intelligence.sampleSize,
    },
    category,
    action: input.action,
    reasons,
    rejected,
    decidedAt: new Date().toISOString(),
    engineVersion: SELECTION_ENGINE_VERSION,
  };
}

/** Failover helper: select the next provider after `failedProviderId` failed. */
export function selectFailover(input: SelectionInput, failedProviderId: string): SelectionDecision {
  return selectProvider({ ...input, excludeProviders: [...(input.excludeProviders ?? []), failedProviderId] });
}
