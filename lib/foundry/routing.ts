import { universalRegistry } from "./universal/registry";
import { getProviderAdapter } from "./providers";
import { UnknownProviderError } from "./registry";
import { classifyActionRisk } from "@/lib/vault/policy";
import { normalizeCategory, type ProviderCategory } from "./universal/types";

/**
 * Provider execution routing (Mission 3).
 *
 * Every operation is routed through the strongest SUPPORTED execution mode, and
 * the choice is explicit and persisted. Foundry never silently falls back from
 * one mode to another: if the strongest supported mode is not actually
 * executable in this runtime, the decision says so (`executable: false`) with a
 * reason, and the caller must raise a human handoff or block — it must not
 * pretend a weaker mode succeeded.
 */
export type ExecutionMode = "API" | "CLI" | "BROWSER" | "HUMAN" | "UNSUPPORTED";

export interface RoutingDecision {
  providerId: string;
  category: ProviderCategory | "unknown";
  action: string;
  mode: ExecutionMode;
  /** True only when Foundry can actually perform this mode right now. */
  executable: boolean;
  /** Whether the operation additionally requires a human approval gate before it runs. */
  requiresHumanGate: boolean;
  reasons: string[];
  engineVersion: string;
}

export const ROUTING_ENGINE_VERSION = "foundry-routing@1";

/** Categories that can only be driven through a real browser session. */
const BROWSER_ONLY_CATEGORIES = new Set<string>(["browser_automation"]);

/**
 * Actions that require an interactive human even when an API exists — these are
 * handoffs, not automatable auth. Kept deliberately small and explicit.
 */
const HUMAN_HANDOFF_ACTION = /(accept_terms|complete_captcha|solve_challenge|passkey|mfa_enroll)/i;

/**
 * Resolve the execution mode for a single planned step.
 *
 * `environment` raises the risk of mutating actions (production), which is used
 * only to decide whether a human gate is additionally required — never to
 * change the mechanical mode.
 */
export function resolveExecutionMode(input: {
  providerId: string;
  action: string;
  environment?: "development" | "staging" | "production";
}): RoutingDecision {
  const reasons: string[] = [];
  const environment = input.environment ?? "development";

  // Unknown provider → UNSUPPORTED, fail closed (never guess a mode).
  let category: ProviderCategory | "unknown";
  let runtimeStatus: string;
  try {
    const adapter = getProviderAdapter(input.providerId);
    category = normalizeCategory(adapter.capability);
  } catch (error) {
    if (error instanceof UnknownProviderError) {
      return {
        providerId: input.providerId,
        category: "unknown",
        action: input.action,
        mode: "UNSUPPORTED",
        executable: false,
        requiresHumanGate: false,
        reasons: [`unknown provider ${input.providerId}`],
        engineVersion: ROUTING_ENGINE_VERSION,
      };
    }
    throw error;
  }

  // Manifest (if registered in the universal registry) carries runtime status
  // and declared capabilities. Missing manifest is treated as mock-grade.
  let declaresAction = true;
  if (universalRegistry.has(input.providerId)) {
    const manifest = universalRegistry.get(input.providerId).manifest;
    runtimeStatus = manifest.runtimeStatus;
    declaresAction = manifest.supportedCapabilities.includes(input.action);
  } else {
    runtimeStatus = "mock";
    reasons.push("provider not in universal registry — treated as mock-grade");
  }

  const risk = classifyActionRisk(input.action, environment);
  const requiresHumanGate =
    risk === "high" || risk === "critical" || HUMAN_HANDOFF_ACTION.test(input.action);
  if (requiresHumanGate) reasons.push(`risk_${risk} requires human approval gate`);

  // 1. Pure human-handoff actions have no automatable mechanism.
  if (HUMAN_HANDOFF_ACTION.test(input.action)) {
    reasons.push("action is an interactive human handoff (no automatable mechanism)");
    return decision("HUMAN", false);
  }

  // 2. Browser-only categories route to BROWSER — but Foundry has no browser
  //    driver provisioned, so it is not executable here (honest, not faked).
  if (BROWSER_ONLY_CATEGORIES.has(category)) {
    reasons.push("category requires a real browser automation session");
    reasons.push("no browser driver provisioned in this runtime — handoff required");
    return decision("BROWSER", false);
  }

  // 3. Unavailable providers are UNSUPPORTED.
  if (runtimeStatus === "unavailable") {
    reasons.push("provider runtime status is unavailable");
    return decision("UNSUPPORTED", false);
  }

  // 4. Everything else executes through the provider API/SDK adapter.
  if (!declaresAction) {
    reasons.push(`provider does not declare action ${input.action}`);
    return decision("UNSUPPORTED", false);
  }
  reasons.push(
    runtimeStatus === "live"
      ? "live provider API adapter"
      : "mock provider API adapter (fails closed in production)"
  );
  return decision("API", true);

  function decision(mode: ExecutionMode, executable: boolean): RoutingDecision {
    return {
      providerId: input.providerId,
      category,
      action: input.action,
      mode,
      executable,
      requiresHumanGate,
      reasons,
      engineVersion: ROUTING_ENGINE_VERSION,
    };
  }
}
