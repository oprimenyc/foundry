import { recordAudit } from "./audit";
import { consumeGrant } from "./leases";
import { classifyActionRisk, killSwitches } from "./policy";
import { VaultAccessError, type ExecutionGrant, type VaultEnvironment } from "./types";

/**
 * Execution authorization gate between the Foundry execution engine and the
 * vault policy layer.
 *
 * Two enforcement tiers:
 *  1. Kill switches apply to EVERY run, always (global, emergency, project,
 *     provider, capability).
 *  2. Risk/approval enforcement applies to runs registered with a vault
 *     context (VERIDIAN M3 runs). Pre-M3 runs keep their M2 behavior, so the
 *     M2 test suite and proof remain valid unchanged.
 */

export interface RunVaultContext {
  runId: string;
  organizationId: string;
  projectId: string;
  environment: VaultEnvironment;
  machineIdentity: string;
  /** Grants indexed by `${scope}:${providerId}:${action}`. */
  grants: Map<string, ExecutionGrant>;
}

const globalContexts = globalThis as unknown as { __primeVaultRunContexts?: Map<string, RunVaultContext> };
if (!globalContexts.__primeVaultRunContexts) globalContexts.__primeVaultRunContexts = new Map();
const contexts = globalContexts.__primeVaultRunContexts;

export function registerRunVaultContext(
  input: Omit<RunVaultContext, "grants">
): RunVaultContext {
  const context: RunVaultContext = { ...input, grants: new Map() };
  contexts.set(input.runId, context);
  return context;
}

export function attachGrantToRun(runId: string, providerId: string, action: string, grant: ExecutionGrant): void {
  const context = contexts.get(runId);
  if (!context) throw new VaultAccessError("Run has no vault context", ["no_run_context"]);
  context.grants.set(`${grant.scope}:${providerId}:${action}`, grant);
}

export function getRunVaultContext(runId: string): RunVaultContext | undefined {
  return contexts.get(runId);
}

export function resetRunVaultContexts(): void {
  contexts.clear();
}

export interface StepAuthorizationInput {
  runId: string;
  projectId: string;
  providerId: string;
  category: string;
  action: string;
  scope?: "forward" | "rollback";
}

/**
 * Fail-closed authorization for one execution (or rollback) step. Throws
 * VaultAccessError with reason codes; the execution engine converts that into
 * a failed step with a redacted message.
 */
export function authorizeStepExecution(input: StepAuthorizationInput): void {
  const scope = input.scope ?? "forward";

  // Tier 1: kill switches bind every run, vault-managed or not.
  const denials: string[] = [];
  if (killSwitches.emergencyDenyAll) denials.push("emergency_deny_all_active");
  if (killSwitches.global) denials.push("global_kill_switch_active");
  if (killSwitches.projects.has(input.projectId)) denials.push("project_kill_switch_active");
  if (killSwitches.providers.has(input.providerId)) denials.push("provider_kill_switch_active");
  if (killSwitches.capabilities.has(input.category)) denials.push("capability_kill_switch_active");
  if (denials.length > 0) {
    recordAudit({
      actor: input.runId,
      action: `gate.${scope}:${input.action}`,
      resource: input.providerId,
      decision: "deny",
      source: "execution-gate",
      correlationId: input.runId,
      metadata: { reasons: denials.join(",") },
    });
    throw new VaultAccessError(`Execution blocked: ${denials.join(", ")}`, denials);
  }

  // Tier 2: risk enforcement for vault-managed runs.
  const context = contexts.get(input.runId);
  if (!context) return; // pre-M3 run — M2 behavior preserved
  if (killSwitches.machineIdentities.has(context.machineIdentity)) {
    throw new VaultAccessError("Machine identity revoked", ["machine_identity_revoked"]);
  }

  const risk = classifyActionRisk(input.action, context.environment);
  if (risk === "high" || risk === "critical") {
    const grant = context.grants.get(`${scope}:${input.providerId}:${input.action}`);
    if (!grant) {
      recordAudit({
        actor: context.machineIdentity,
        action: `gate.${scope}:${input.action}`,
        resource: input.providerId,
        decision: "deny",
        source: "execution-gate",
        correlationId: input.runId,
        metadata: { reason: "approval_grant_missing", risk },
      });
      throw new VaultAccessError(`${risk}-risk ${scope} action requires an approved execution grant`, ["approval_grant_missing"]);
    }
    // Consumes one use; validates run/provider/action/expiry/revocation/scope.
    consumeGrant(grant.grantId, {
      runId: input.runId,
      providerId: input.providerId,
      capability: input.category,
      action: input.action,
      secretReferenceIds: [],
      scope,
    });
  }
  recordAudit({
    actor: context.machineIdentity,
    action: `gate.${scope}:${input.action}`,
    resource: input.providerId,
    decision: "allow",
    source: "execution-gate",
    correlationId: input.runId,
    metadata: { risk },
  });
}
