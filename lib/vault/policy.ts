import { randomUUID } from "crypto";
import { recordAudit } from "./audit";
import { findStandingApproval, getApproval } from "./approvals";
import type { RiskLevel, VaultAccessDecision, VaultAccessRequest } from "./types";

export const POLICY_VERSION = "prime-vault-policy@1";

/**
 * Approval-gated action policy. Deterministic, explainable, fail-closed.
 * Evaluates org/project/environment/identity/capability/provider/action/
 * target/risk/cost/kill-switch state and returns an auditable decision.
 */

export interface KillSwitchState {
  global: boolean;
  emergencyDenyAll: boolean;
  projects: Set<string>;
  providers: Set<string>;
  capabilities: Set<string>;
  machineIdentities: Set<string>;
}

const globalSwitches = globalThis as unknown as { __primeVaultKill?: KillSwitchState };
if (!globalSwitches.__primeVaultKill) {
  globalSwitches.__primeVaultKill = {
    global: false,
    emergencyDenyAll: false,
    projects: new Set(),
    providers: new Set(),
    capabilities: new Set(),
    machineIdentities: new Set(),
  };
}
export const killSwitches = globalSwitches.__primeVaultKill;

export function setGlobalKillSwitch(on: boolean, actor = "founder"): void {
  killSwitches.global = on;
  recordAudit({ actor, action: "killswitch.global", resource: "global", decision: "info", source: "policy", correlationId: `ks_${randomUUID()}`, metadata: { on } });
}

export function setEmergencyDenyAll(on: boolean, actor = "founder"): void {
  killSwitches.emergencyDenyAll = on;
  recordAudit({ actor, action: "killswitch.emergency_deny_all", resource: "global", decision: "info", source: "policy", correlationId: `ks_${randomUUID()}`, metadata: { on } });
}

export function setProjectKillSwitch(projectId: string, on: boolean): void {
  if (on) killSwitches.projects.add(projectId);
  else killSwitches.projects.delete(projectId);
}

export function setProviderKillSwitch(providerId: string, on: boolean): void {
  if (on) killSwitches.providers.add(providerId);
  else killSwitches.providers.delete(providerId);
}

export function setCapabilityKillSwitch(capability: string, on: boolean): void {
  if (on) killSwitches.capabilities.add(capability);
  else killSwitches.capabilities.delete(capability);
}

export function revokeMachineIdentity(machineIdentity: string): void {
  killSwitches.machineIdentities.add(machineIdentity);
}

export function resetKillSwitches(): void {
  killSwitches.global = false;
  killSwitches.emergencyDenyAll = false;
  killSwitches.projects.clear();
  killSwitches.providers.clear();
  killSwitches.capabilities.clear();
  killSwitches.machineIdentities.clear();
}

/** Deterministic risk classification for actions the catalog knows about. */
const ACTION_RISK: Array<{ pattern: RegExp; risk: RiskLevel }> = [
  { pattern: /^(delete|drop|destroy|purge)_.*(database|db|production)/i, risk: "critical" },
  { pattern: /(transfer_funds|change_billing|payout)/i, risk: "critical" },
  { pattern: /^(delete|drop|destroy|purge)_/i, risk: "high" },
  { pattern: /(dns|certificate|domain)/i, risk: "high" },
  { pattern: /^(create|trigger|deploy|send|store|configure)_/i, risk: "moderate" },
  { pattern: /^(verify|read|get|list|check)_/i, risk: "low" },
];

export function classifyActionRisk(action: string, environment: string): RiskLevel {
  let risk: RiskLevel = "moderate";
  for (const entry of ACTION_RISK) {
    if (entry.pattern.test(action)) {
      risk = entry.risk;
      break;
    }
  }
  // Production raises moderate to high for mutating actions; never lowers.
  if (environment === "production" && risk === "moderate" && !/^(verify|read|get|list|check)_/.test(action)) {
    return "high";
  }
  return risk;
}

export interface PolicyLimits {
  /** Per-request cost ceiling by risk level (USD). */
  maxCostUsdByRisk?: Partial<Record<RiskLevel, number>>;
}

const DEFAULT_COST_CEILINGS: Record<RiskLevel, number> = {
  low: 10,
  moderate: 100,
  high: 500,
  critical: 0, // critical actions never pass on cost alone — manual approval required anyway
};

const RISK_MAX_DURATION_MS: Record<RiskLevel, number> = {
  low: 15 * 60_000,
  moderate: 10 * 60_000,
  high: 5 * 60_000,
  critical: 2 * 60_000,
};

/**
 * The policy gate. High/critical risk NEVER receives standing approval by
 * default: it needs a manual approval recorded for this request (or an
 * explicit standing policy that itself was founder-created for ≤ moderate).
 */
export function evaluatePolicy(
  request: VaultAccessRequest,
  options: { approvalId?: string; limits?: PolicyLimits } = {}
): VaultAccessDecision {
  const correlationId = `pol_${randomUUID()}`;
  const deny = (denialReasons: string[], reasonCodes: string[] = denialReasons): VaultAccessDecision => {
    const decision: VaultAccessDecision = {
      allow: false,
      scopesGranted: [],
      approvalSource: "none",
      policyVersion: POLICY_VERSION,
      maxDurationMs: 0,
      maxUses: 0,
      reasonCodes,
      denialReasons,
      auditCorrelationId: correlationId,
    };
    audit(request, decision);
    return decision;
  };

  // Kill switches dominate everything.
  if (killSwitches.emergencyDenyAll) return deny(["emergency_deny_all_active"]);
  if (killSwitches.global) return deny(["global_kill_switch_active"]);
  if (killSwitches.projects.has(request.projectId)) return deny(["project_kill_switch_active"]);
  if (killSwitches.providers.has(request.providerId)) return deny(["provider_kill_switch_active"]);
  if (killSwitches.capabilities.has(request.capability)) return deny(["capability_kill_switch_active"]);
  if (killSwitches.machineIdentities.has(request.machineIdentity)) return deny(["machine_identity_revoked"]);

  const risk = request.riskLevel;
  const ceiling = options.limits?.maxCostUsdByRisk?.[risk] ?? DEFAULT_COST_CEILINGS[risk];
  if (risk !== "critical" && request.estimatedCostUsd > ceiling) {
    return deny([`estimated cost $${request.estimatedCostUsd} exceeds ${risk} ceiling $${ceiling}`], ["cost_ceiling_exceeded"]);
  }

  // Approval requirements by risk.
  let approvalSource: VaultAccessDecision["approvalSource"] = "policy";
  let approvalId = options.approvalId;
  if (risk === "high" || risk === "critical") {
    const approval = approvalId ? getApproval(approvalId) : undefined;
    if (!approval || approval.status !== "approved") {
      return deny([`${risk}-risk action requires manual approval`], ["manual_approval_required"]);
    }
    if (approval.request.runId !== request.runId && approval.mode !== "allow_until") {
      return deny(["approval is bound to a different run"], ["approval_run_mismatch"]);
    }
    if (approval.mode === "allow_until" && approval.validUntil && approval.validUntil < new Date().toISOString()) {
      return deny(["approval window expired"], ["approval_expired"]);
    }
    approvalSource = "manual";
  } else {
    // Low/moderate: a standing recurring policy may authorize automatically.
    const standing = findStandingApproval(request);
    if (standing) {
      approvalSource = "standing";
      approvalId = standing.approvalId;
    }
  }

  const maxDurationMs = Math.min(request.requestedDurationMs || RISK_MAX_DURATION_MS[risk], RISK_MAX_DURATION_MS[risk]);
  const decision: VaultAccessDecision = {
    allow: true,
    scopesGranted: [`${request.providerId}:${request.capability}:${request.intendedAction}`],
    approvalSource,
    approvalId,
    policyVersion: POLICY_VERSION,
    maxDurationMs,
    maxUses: 1,
    reasonCodes: [`risk_${risk}`, `approval_${approvalSource}`],
    denialReasons: [],
    auditCorrelationId: correlationId,
  };
  audit(request, decision);
  return decision;
}

function audit(request: VaultAccessRequest, decision: VaultAccessDecision): void {
  recordAudit({
    actor: request.machineIdentity,
    action: `policy.evaluate:${request.intendedAction}`,
    resource: `${request.providerId}/${request.targetResource}`,
    decision: decision.allow ? "allow" : "deny",
    source: "policy",
    correlationId: decision.auditCorrelationId,
    metadata: {
      runId: request.runId,
      risk: request.riskLevel,
      reasons: (decision.allow ? decision.reasonCodes : decision.denialReasons).join(","),
      secretReferences: request.secretReferenceIds.join(","),
    },
  });
}
