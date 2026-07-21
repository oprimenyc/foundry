import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionProviderType, ProviderActionRequest, ProviderActionType } from "../types";

/**
 * Safe adapter boundary (Phase 2). Every adapter here is dry-run/advisory
 * only: `advise()` is a pure, synchronous function that describes what a
 * live action would require — it never makes an HTTP call, never touches a
 * provider SDK, and never accepts a live-mode escape hatch (mirrors
 * lib/secret-remediation/adapters/types.ts exactly, generalized from a
 * secret-exposure finding to an arbitrary provider action request).
 */
export interface ProviderActionAdapter {
  readonly adapterId: string;
  readonly providerType: ProviderActionProviderType;
  readonly actionType: ProviderActionType;
  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory;
}
