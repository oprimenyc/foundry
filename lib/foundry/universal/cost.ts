import type { ProviderManifest } from "./types";

/**
 * Provider Cost Engine.
 *
 * Costs are DECLARED ESTIMATES from provider manifests, used to rank otherwise
 * equivalent providers. They are never billing truth and never block a run on
 * their own — tenant policy caps do.
 */
export interface ActionCostEstimate {
  providerId: string;
  currency: "USD";
  amountPerAction: number;
  monthlyFloor: number;
  /** Comparable scalar: per-action cost dominates; the floor tie-breaks. */
  comparable: number;
}

export function estimateActionCost(manifest: ProviderManifest): ActionCostEstimate {
  const { amountPerAction, monthlyFloor } = manifest.estimatedCost;
  return {
    providerId: manifest.id,
    currency: "USD",
    amountPerAction,
    monthlyFloor,
    comparable: amountPerAction + monthlyFloor / 10000,
  };
}

/** Cheapest-first ranking across manifests. Deterministic (id tie-break). */
export function rankByCost(manifests: ProviderManifest[]): ActionCostEstimate[] {
  return manifests
    .map(estimateActionCost)
    .sort((a, b) => a.comparable - b.comparable || a.providerId.localeCompare(b.providerId));
}

export function exceedsMonthlyCap(manifest: ProviderManifest, maxMonthlyCostUsd?: number): boolean {
  if (maxMonthlyCostUsd === undefined) return false;
  return manifest.estimatedCost.monthlyFloor > maxMonthlyCostUsd;
}
