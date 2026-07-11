import type { ProviderAdapter, ProviderExecutionInput, ProviderExecutionResult } from "@/lib/foundry/providers";
import type { ProviderAction } from "@/lib/foundry/types";

/**
 * Universal provider categories. Foundry execution never branches on a vendor
 * name — only on a category + declared action, resolved through the registry.
 */
export const PROVIDER_CATEGORIES = [
  "hosting",
  "repository",
  "dns",
  "email",
  "sms",
  "voice",
  "database",
  "payments",
  "identity",
  "storage",
  "analytics",
  "monitoring",
  "browser_automation",
  "llm",
  "search_console",
  "business_listing",
  "maps",
  "calendar",
  "crm",
  "forms",
] as const;

export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

/**
 * Legacy capability ids kept as aliases so pre-M2 plans, adapters, and API
 * consumers keep working. Normalized at every registry boundary.
 */
export const LEGACY_CATEGORY_ALIASES: Record<string, ProviderCategory> = {
  deployment: "hosting",
  telephony: "sms",
};

export function normalizeCategory(value: string): ProviderCategory {
  const alias = LEGACY_CATEGORY_ALIASES[value];
  if (alias) return alias;
  if ((PROVIDER_CATEGORIES as readonly string[]).includes(value)) return value as ProviderCategory;
  throw new UnknownCategoryError(value);
}

export class UnknownCategoryError extends Error {
  constructor(public readonly category: string) {
    super(`Unknown provider category: "${category}"`);
    this.name = "UnknownCategoryError";
  }
}

/** Cost is an estimate for planning/selection only — never billing truth. */
export interface ProviderCostEstimate {
  currency: "USD";
  /** Estimated cost per executed action. 0 for free tiers/mocks. */
  amountPerAction: number;
  /** Estimated fixed monthly floor (subscriptions, reserved capacity). */
  monthlyFloor: number;
}

export type ProviderRuntimeStatus = "live" | "mock" | "unavailable";

/** Everything a provider must declare to exist in the ecosystem. */
export interface ProviderManifest {
  id: string;
  name: string;
  category: ProviderCategory;
  /** Declared executable actions (capability surface). */
  supportedCapabilities: ProviderAction[];
  /** Env-var names required for live execution. Names only — never values. */
  requiredCredentials: string[];
  estimatedCost: ProviderCostEstimate;
  estimatedLatencyMs: number;
  limitations: string[];
  documentationUrl: string;
  /** Truthful runtime status at registration time. */
  runtimeStatus: ProviderRuntimeStatus;
}

export interface ProviderHealthStatus {
  providerId: string;
  healthy: boolean;
  detail: string;
  latencyMs: number;
  checkedAt: string;
}

export interface ProviderVerificationResult {
  providerId: string;
  ok: boolean;
  detail: string;
  checkedAt: string;
  verifierVersion: string;
}

/**
 * The universal provider contract: the existing execution adapter contract
 * (execute/compensate — compensate IS rollback) plus manifest, health check,
 * and independent self-verification.
 */
export interface UniversalProvider extends ProviderAdapter {
  manifest: ProviderManifest;
  healthCheck(): Promise<ProviderHealthStatus>;
  verify(input?: ProviderExecutionInput): Promise<ProviderVerificationResult>;
  /** Alias for compensate, present so callers can speak the universal contract. */
  rollback(action: ProviderAction, input: ProviderExecutionInput & { providerReference?: string }): Promise<void>;
}

/** Tenant policy: the only place preferences/limits about providers may live. */
export interface TenantPolicy {
  tenantId: string;
  /** Preferred provider id per category (soft preference, wins ties and ranking). */
  preferredProviders?: Partial<Record<ProviderCategory, string>>;
  /** If set for a category, only these provider ids are eligible. */
  allowedProviders?: Partial<Record<ProviderCategory, string[]>>;
  /** Never eligible, regardless of anything else. */
  blockedProviders?: string[];
  /** Reject providers whose estimated monthly floor exceeds this. */
  maxMonthlyCostUsd?: number;
  /** Reject providers whose estimated latency exceeds this. */
  maxLatencyMs?: number;
  requiredRegions?: string[];
  complianceRules?: string[];
}

export const DEFAULT_TENANT_POLICY: TenantPolicy = { tenantId: "default" };

export interface SelectionInput {
  category: ProviderCategory | string;
  action: ProviderAction;
  tenantPolicy?: TenantPolicy;
  /** Providers already tried and failed in this run (failover support). */
  excludeProviders?: string[];
  /**
   * When present, credential availability is answered by Prime Vault secret
   * REFERENCES (metadata only) instead of raw env presence. Selection never
   * resolves values.
   */
  vaultScope?: {
    organizationId: string;
    projectId: string;
    environment: "development" | "staging" | "production";
  };
}

export interface SelectionRejection {
  providerId: string;
  reason: string;
}

export interface SelectionDecision {
  providerId: string;
  category: ProviderCategory;
  action: ProviderAction;
  reasons: string[];
  rejected: SelectionRejection[];
  decidedAt: string;
  engineVersion: string;
  /** Explainable Provider Intelligence components for the winner (M3). */
  intelligence?: {
    score: number;
    components: Record<string, number>;
    reasons: string[];
    sampleSize: number;
  };
}

export class NoEligibleProviderError extends Error {
  constructor(
    public readonly category: string,
    public readonly action: string,
    public readonly rejected: SelectionRejection[]
  ) {
    super(
      `No eligible ${category} provider for action "${action}". Rejections: ${
        rejected.map((r) => `${r.providerId}: ${r.reason}`).join("; ") || "no providers registered"
      }`
    );
    this.name = "NoEligibleProviderError";
  }
}

export type { ProviderExecutionInput, ProviderExecutionResult, ProviderAction };
