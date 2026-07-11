import { universalRegistry } from "./registry";
import { credentialStatusFor } from "./credentials";
import type { ProviderVerificationResult, SelectionDecision } from "./types";

export const PROVIDER_VERIFIER_VERSION = "foundry-provider-verifier@1";

/**
 * Provider Verification Engine.
 *
 * Independent of execution: asks the provider to verify itself (reachability /
 * self-consistency), never trusting an execute() result. E.V.E. consumes these
 * alongside run-level verification records.
 */
export async function verifyProvider(providerId: string): Promise<ProviderVerificationResult> {
  const provider = universalRegistry.get(providerId);
  try {
    return await provider.verify();
  } catch (error) {
    return {
      providerId,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
      verifierVersion: PROVIDER_VERIFIER_VERSION,
    };
  }
}

/**
 * Verifies a selection decision is still sound: the chosen provider exists,
 * declares the action, and its credential posture matches its runtime status.
 */
export function verifySelectionDecision(decision: SelectionDecision): { ok: boolean; detail: string } {
  if (!universalRegistry.has(decision.providerId)) {
    return { ok: false, detail: `provider ${decision.providerId} is no longer registered` };
  }
  const provider = universalRegistry.get(decision.providerId);
  if (!provider.manifest.supportedCapabilities.includes(decision.action)) {
    return { ok: false, detail: `provider ${decision.providerId} no longer declares action ${decision.action}` };
  }
  const credentials = credentialStatusFor(provider.manifest);
  if (provider.manifest.runtimeStatus === "live" && !credentials.satisfied) {
    return { ok: false, detail: `live provider missing credentials: ${credentials.missingReferences.join(", ")}` };
  }
  return { ok: true, detail: `provider ${decision.providerId} verified for ${decision.category}.${decision.action}` };
}
