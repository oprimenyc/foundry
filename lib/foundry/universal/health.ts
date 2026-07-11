import type { ProviderHealthStatus, UniversalProvider } from "./types";

/**
 * Provider Health Engine.
 *
 * Two signals per provider:
 *  1. Active probes — provider.healthCheck() with a hard timeout.
 *  2. Passive outcomes — execution successes/failures recorded by callers.
 *
 * Score is a rolling success ratio over the most recent window. Providers with
 * no history score 1.0 (innocent until observed failing) so a fresh registry
 * never deadlocks selection.
 */
const WINDOW_SIZE = 20;

interface HealthState {
  outcomes: boolean[]; // newest last
  lastProbe?: ProviderHealthStatus;
}

const globalHealth = globalThis as unknown as { __foundryHealthState?: Map<string, HealthState> };
if (!globalHealth.__foundryHealthState) globalHealth.__foundryHealthState = new Map();
const state = globalHealth.__foundryHealthState;

function stateFor(providerId: string): HealthState {
  let entry = state.get(providerId);
  if (!entry) {
    entry = { outcomes: [] };
    state.set(providerId, entry);
  }
  return entry;
}

export function recordOutcome(providerId: string, ok: boolean): void {
  const entry = stateFor(providerId);
  entry.outcomes.push(ok);
  if (entry.outcomes.length > WINDOW_SIZE) entry.outcomes.shift();
}

/** Rolling success ratio in [0,1]. No history → 1.0. */
export function healthScore(providerId: string): number {
  const entry = state.get(providerId);
  if (!entry || entry.outcomes.length === 0) return 1;
  const successes = entry.outcomes.filter(Boolean).length;
  return successes / entry.outcomes.length;
}

export async function probeProvider(provider: UniversalProvider, timeoutMs = 5000): Promise<ProviderHealthStatus> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let status: ProviderHealthStatus;
  try {
    status = await Promise.race([
      provider.healthCheck(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`health check timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    status = {
      providerId: provider.provider,
      healthy: false,
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
  const entry = stateFor(provider.provider);
  entry.lastProbe = status;
  recordOutcome(provider.provider, status.healthy);
  return status;
}

export function lastProbe(providerId: string): ProviderHealthStatus | undefined {
  return state.get(providerId)?.lastProbe;
}

export function healthSnapshot(): Array<{ providerId: string; score: number; lastProbe?: ProviderHealthStatus }> {
  return Array.from(state.entries())
    .map(([providerId, entry]) => ({ providerId, score: healthScore(providerId), lastProbe: entry.lastProbe }))
    .sort((a, b) => a.providerId.localeCompare(b.providerId));
}

/** Test/reset hook: clears recorded health state. */
export function resetHealthState(): void {
  state.clear();
}
