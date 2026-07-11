import { healthScore } from "./health";
import { estimateActionCost } from "./cost";
import { universalRegistry } from "./registry";

/**
 * Provider Intelligence layer. Records execution observations and produces a
 * DETERMINISTIC, explainable score — recorded components, no opaque model.
 * Extends the Selection Engine; never replaces it.
 */

export type ObservationKind =
  | "execution_success"
  | "execution_failure"
  | "rollback"
  | "verification_failure"
  | "rate_limit"
  | "auth_failure"
  | "credential_failure";

export interface ProviderObservation {
  providerId: string;
  kind: ObservationKind;
  capability?: string;
  tenantId?: string;
  latencyMs?: number;
  costUsd?: number;
  at: string;
}

export interface ProviderIncident {
  id: string;
  providerId: string;
  capability?: string;
  severity: "minor" | "major" | "critical";
  summary: string;
  openedAt: string;
  resolvedAt?: string;
  resolutionEvidence?: string;
}

interface ProviderIntelState {
  observations: ProviderObservation[];
  incidents: ProviderIncident[];
  lastSuccessAt?: string;
}

const WINDOW = 200;
/** Sample-size confidence: n / (n + K). 42 samples ≈ 0.81 confidence. */
const CONFIDENCE_K = 10;
/** Cold-start neutral prior for historical reliability. */
const NEUTRAL_PRIOR = 0.7;

const globalIntel = globalThis as unknown as { __foundryIntel?: Map<string, ProviderIntelState> };
if (!globalIntel.__foundryIntel) globalIntel.__foundryIntel = new Map();
const intel = globalIntel.__foundryIntel;

function stateFor(providerId: string): ProviderIntelState {
  let entry = intel.get(providerId);
  if (!entry) {
    entry = { observations: [], incidents: [] };
    intel.set(providerId, entry);
  }
  return entry;
}

export function recordObservation(input: Omit<ProviderObservation, "at">): void {
  const entry = stateFor(input.providerId);
  entry.observations.push({ ...input, at: new Date().toISOString() });
  if (entry.observations.length > WINDOW) entry.observations.shift();
  if (input.kind === "execution_success") entry.lastSuccessAt = new Date().toISOString();
}

export function openIncident(input: Omit<ProviderIncident, "id" | "openedAt">): ProviderIncident {
  const incident: ProviderIncident = {
    ...input,
    id: `inc_${Math.random().toString(36).slice(2, 10)}`,
    openedAt: new Date().toISOString(),
  };
  stateFor(input.providerId).incidents.push(incident);
  return incident;
}

export function resolveIncident(providerId: string, incidentId: string, resolutionEvidence: string): void {
  const incident = stateFor(providerId).incidents.find((item) => item.id === incidentId);
  if (!incident) throw new Error(`Incident ${incidentId} not found for ${providerId}`);
  incident.resolvedAt = new Date().toISOString();
  incident.resolutionEvidence = resolutionEvidence;
}

export function openIncidents(providerId: string): ProviderIncident[] {
  return stateFor(providerId).incidents.filter((incident) => !incident.resolvedAt);
}

export function listIncidents(): ProviderIncident[] {
  return Array.from(intel.values()).flatMap((entry) => entry.incidents);
}

export interface IntelligenceScore {
  providerId: string;
  score: number;
  components: {
    policy: number;
    credentialAvailability: number;
    health: number;
    historicalReliability: number;
    capabilityReliability: number;
    tenantReliability: number;
    cost: number;
    latency: number;
    incidentPenalty: number;
    confidence: number;
  };
  reasons: string[];
  sampleSize: number;
  disqualified: boolean;
}

function reliabilityOver(observations: ProviderObservation[]): { ratio: number; n: number } {
  const outcomes = observations.filter((o) => o.kind === "execution_success" || o.kind === "execution_failure");
  if (outcomes.length === 0) return { ratio: NEUTRAL_PRIOR, n: 0 };
  const successes = outcomes.filter((o) => o.kind === "execution_success").length;
  return { ratio: successes / outcomes.length, n: outcomes.length };
}

/**
 * Deterministic composite score in [0,1]. Weighted blend of recorded
 * components; every component and reason is returned for explainability.
 * An open critical incident disqualifies the provider outright.
 */
export function computeIntelligenceScore(
  providerId: string,
  context: { capability?: string; tenantId?: string; policyEligible?: boolean; credentialAvailable?: boolean } = {}
): IntelligenceScore {
  const entry = stateFor(providerId);
  const manifest = universalRegistry.has(providerId) ? universalRegistry.get(providerId).manifest : undefined;

  const overall = reliabilityOver(entry.observations);
  const byCapability = context.capability
    ? reliabilityOver(entry.observations.filter((o) => o.capability === context.capability))
    : overall;
  const byTenant = context.tenantId
    ? reliabilityOver(entry.observations.filter((o) => o.tenantId === context.tenantId))
    : overall;

  const incidents = openIncidents(providerId);
  const critical = incidents.some((incident) => incident.severity === "critical");
  const incidentPenalty = critical ? 1 : incidents.some((i) => i.severity === "major") ? 0.4 : incidents.length > 0 ? 0.15 : 0;

  const confidence = overall.n / (overall.n + CONFIDENCE_K);
  const health = healthScore(providerId);
  // Cost/latency normalized against manifest declarations (bounded 0..1).
  const costComparable = manifest ? estimateActionCost(manifest).comparable : 0;
  const cost = 1 / (1 + costComparable);
  const latency = manifest ? 1 / (1 + manifest.estimatedLatencyMs / 1000) : 0.5;
  const policy = context.policyEligible === false ? 0 : 1;
  const credentialAvailability = context.credentialAvailable === false ? 0 : 1;

  // Confidence blends history toward the neutral prior: low samples → prior dominates.
  const blended = (value: number) => confidence * value + (1 - confidence) * NEUTRAL_PRIOR;
  const historicalReliability = blended(overall.ratio);
  const capabilityReliability = blended(byCapability.ratio);
  const tenantReliability = blended(byTenant.ratio);

  const raw =
    0.2 * health +
    0.25 * historicalReliability +
    0.15 * capabilityReliability +
    0.1 * tenantReliability +
    0.15 * cost +
    0.15 * latency;
  const score = policy * credentialAvailability * Math.max(0, raw * (1 - incidentPenalty));

  const reasons: string[] = [
    context.policyEligible === false ? "ineligible under tenant policy" : "eligible under tenant policy",
    context.credentialAvailable === false ? "no eligible credential reference" : "credential reference available",
    `health score ${health.toFixed(2)}`,
    overall.n > 0
      ? `${Math.round(overall.ratio * 100)}% successful executions over ${overall.n} observations`
      : "no execution history — neutral prior, low confidence",
    critical
      ? "DISQUALIFIED: open critical incident"
      : incidents.length > 0
        ? `${incidents.length} open incident(s) penalizing score`
        : "no active incidents",
    `confidence ${confidence.toFixed(2)} (sample size ${overall.n})`,
  ];

  return {
    providerId,
    score: Number(score.toFixed(4)),
    components: {
      policy,
      credentialAvailability,
      health: Number(health.toFixed(4)),
      historicalReliability: Number(historicalReliability.toFixed(4)),
      capabilityReliability: Number(capabilityReliability.toFixed(4)),
      tenantReliability: Number(tenantReliability.toFixed(4)),
      cost: Number(cost.toFixed(4)),
      latency: Number(latency.toFixed(4)),
      incidentPenalty,
      confidence: Number(confidence.toFixed(4)),
    },
    reasons,
    sampleSize: overall.n,
    disqualified: critical,
  };
}

export function intelligenceSnapshot(): Array<
  IntelligenceScore & { lastSuccessAt?: string; openIncidents: number }
> {
  const ids = new Set<string>([...Array.from(intel.keys()), ...universalRegistry.list()]);
  return Array.from(ids)
    .sort()
    .map((providerId) => ({
      ...computeIntelligenceScore(providerId),
      lastSuccessAt: intel.get(providerId)?.lastSuccessAt,
      openIncidents: openIncidents(providerId).length,
    }));
}

export function resetIntelligence(): void {
  intel.clear();
}
