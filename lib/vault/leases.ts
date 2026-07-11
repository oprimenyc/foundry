import { randomUUID } from "crypto";
import { recordAudit } from "./audit";
import { VaultAccessError, type ExecutionGrant, type VaultAccessDecision, type VaultAccessRequest } from "./types";

/**
 * Execution grants: short-lived, scoped, one-time (or limited-use),
 * non-transferable, revocable, fail-closed authorizations. A grant is not a
 * secret — holding one outside the trusted executor resolves nothing, because
 * validation binds it to the run, provider, capability, and action.
 */
const globalGrants = globalThis as unknown as { __primeVaultGrants?: Map<string, ExecutionGrant> };
if (!globalGrants.__primeVaultGrants) globalGrants.__primeVaultGrants = new Map();
const grants = globalGrants.__primeVaultGrants;

export function issueExecutionGrant(
  request: VaultAccessRequest,
  decision: VaultAccessDecision,
  scope: ExecutionGrant["scope"] = "forward"
): ExecutionGrant {
  if (!decision.allow) throw new VaultAccessError("Cannot issue a grant from a denied decision", ["decision_denied"]);
  const now = Date.now();
  const grant: ExecutionGrant = {
    grantId: `grant_${randomUUID()}`,
    runId: request.runId,
    allowedSecretReferenceIds: [...request.secretReferenceIds],
    allowedProviderId: request.providerId,
    allowedCapabilities: [request.capability],
    allowedAction: request.intendedAction,
    targetConstraints: [request.targetResource],
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + decision.maxDurationMs).toISOString(),
    maxUses: decision.maxUses,
    useCount: 0,
    revoked: false,
    approvalId: decision.approvalId,
    scope,
  };
  grants.set(grant.grantId, grant);
  recordAudit({
    actor: request.machineIdentity,
    action: "grant.issue",
    resource: grant.grantId,
    decision: "allow",
    source: "leases",
    correlationId: decision.auditCorrelationId,
    metadata: { runId: grant.runId, provider: grant.allowedProviderId, action: grant.allowedAction, scope, expiresAt: grant.expiresAt },
  });
  return { ...grant };
}

export interface GrantUseContext {
  runId: string;
  providerId: string;
  capability: string;
  action: string;
  secretReferenceIds: string[];
  scope?: ExecutionGrant["scope"];
}

/** Validates AND consumes one use. Every failure is a hard, audited denial. */
export function consumeGrant(grantId: string, context: GrantUseContext): ExecutionGrant {
  const grant = grants.get(grantId);
  const fail = (reason: string): never => {
    recordAudit({
      actor: context.runId,
      action: "grant.consume",
      resource: grantId,
      decision: "deny",
      source: "leases",
      correlationId: grantId,
      metadata: { reason },
    });
    throw new VaultAccessError(`Execution grant rejected: ${reason}`, [reason]);
  };
  if (!grant) return fail("unknown_grant");
  if (grant.revoked) return fail("grant_revoked");
  if (grant.expiresAt < new Date().toISOString()) return fail("grant_expired");
  if (grant.useCount >= grant.maxUses) return fail("grant_uses_exhausted");
  if (grant.runId !== context.runId) return fail("grant_run_mismatch");
  if (grant.allowedProviderId !== context.providerId) return fail("grant_provider_mismatch");
  if (!grant.allowedCapabilities.includes(context.capability)) return fail("grant_capability_mismatch");
  if (grant.allowedAction !== context.action) return fail("grant_action_mismatch");
  if ((context.scope ?? "forward") !== grant.scope) return fail("grant_scope_mismatch");
  for (const referenceId of context.secretReferenceIds) {
    if (!grant.allowedSecretReferenceIds.includes(referenceId)) return fail("grant_reference_not_allowed");
  }
  grant.useCount += 1;
  recordAudit({
    actor: context.runId,
    action: "grant.consume",
    resource: grantId,
    decision: "allow",
    source: "leases",
    correlationId: grantId,
    metadata: { useCount: grant.useCount, maxUses: grant.maxUses },
  });
  return { ...grant };
}

export function revokeGrant(grantId: string, reason: string, actor = "founder"): void {
  const grant = grants.get(grantId);
  if (!grant) throw new VaultAccessError("Grant not found", ["unknown_grant"]);
  grant.revoked = true;
  grant.revokedReason = reason;
  recordAudit({ actor, action: "grant.revoke", resource: grantId, decision: "info", source: "leases", correlationId: grantId, metadata: { reason } });
}

export function revokeAllGrants(reason: string, actor = "founder"): number {
  let count = 0;
  for (const grant of Array.from(grants.values())) {
    if (!grant.revoked) {
      grant.revoked = true;
      grant.revokedReason = reason;
      count += 1;
    }
  }
  recordAudit({ actor, action: "grant.revoke_all", resource: "all", decision: "info", source: "leases", correlationId: `rga_${randomUUID()}`, metadata: { count, reason } });
  return count;
}

export function listGrants(filter?: { runId?: string; active?: boolean }): ExecutionGrant[] {
  const now = new Date().toISOString();
  return Array.from(grants.values())
    .filter(
      (grant) =>
        (!filter?.runId || grant.runId === filter.runId) &&
        (filter?.active === undefined ||
          filter.active === (!grant.revoked && grant.expiresAt > now && grant.useCount < grant.maxUses))
    )
    .map((grant) => ({ ...grant }));
}

export function resetGrants(): void {
  grants.clear();
}
