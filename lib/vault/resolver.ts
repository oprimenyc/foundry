import { recordAudit } from "./audit";
import { consumeGrant } from "./leases";
import { killSwitches } from "./policy";
import { getSecretReference } from "./registry";
import {
  VaultAccessError,
  type ExecutionGrant,
  type ResolvedSecretLease,
  type VaultAccessRequest,
} from "./types";
import type { VaultAdapter } from "./adapters/interface";

/**
 * TRUSTED SECRET RESOLVER — the only module allowed to call
 * VaultAdapter.resolveForExecution. It must never be imported by client
 * bundles, dashboard loaders, planner/LLM tools, or E.V.E. code
 * (tests/vault.test.ts enforces this with an import scan).
 */

const globalAdapter = globalThis as unknown as { __primeVaultAdapter?: VaultAdapter };

export function configureVaultAdapter(adapter: VaultAdapter): void {
  globalAdapter.__primeVaultAdapter = adapter;
}

export function getVaultAdapter(): VaultAdapter {
  const adapter = globalAdapter.__primeVaultAdapter;
  if (!adapter) throw new VaultAccessError("No vault adapter configured — resolution fails closed", ["no_adapter"]);
  return adapter;
}

function assertTrustedRuntime(): void {
  // Browser bundles fail closed even if the import guard is bypassed.
  if (typeof window !== "undefined") {
    throw new VaultAccessError("Secret resolution is impossible in a browser context", ["browser_forbidden"]);
  }
}

/**
 * Resolve secrets for one approved action. The caller must already hold a
 * valid ExecutionGrant (issued after policy evaluation + approval). This
 * function re-validates everything and fails closed:
 *   grant validity/uses/expiry/run/provider/action → kill switches →
 *   reference scope (org/project/environment) → backend resolution.
 */
export async function resolveSecretsForExecution(
  request: VaultAccessRequest,
  grant: ExecutionGrant
): Promise<ResolvedSecretLease[]> {
  assertTrustedRuntime();

  // Kill switches are re-checked at resolution time, not just at policy time.
  if (killSwitches.emergencyDenyAll || killSwitches.global) {
    recordAudit({
      actor: request.machineIdentity,
      action: "resolver.resolve",
      resource: grant.grantId,
      decision: "deny",
      source: "resolver",
      correlationId: grant.grantId,
      metadata: { reason: "kill_switch_active", runId: request.runId },
    });
    throw new VaultAccessError("Kill switch active — secret resolution blocked", ["kill_switch_active"]);
  }
  if (killSwitches.providers.has(request.providerId)) {
    throw new VaultAccessError("Provider kill switch active", ["provider_kill_switch_active"]);
  }
  if (killSwitches.projects.has(request.projectId)) {
    throw new VaultAccessError("Project kill switch active", ["project_kill_switch_active"]);
  }

  // Consume one grant use — validates run/provider/capability/action/refs/expiry/revocation.
  consumeGrant(grant.grantId, {
    runId: request.runId,
    providerId: request.providerId,
    capability: request.capability,
    action: request.intendedAction,
    secretReferenceIds: request.secretReferenceIds,
    scope: grant.scope,
  });

  // Scope validation on every reference (cross-tenant/project/environment fail closed).
  const scope = {
    organizationId: request.organizationId,
    projectId: request.projectId,
    environment: request.environment,
    actor: request.machineIdentity,
  };
  for (const referenceId of request.secretReferenceIds) {
    const reference = getSecretReference(referenceId, scope);
    if (reference.status === "revoked") throw new VaultAccessError("Secret reference revoked", ["reference_revoked"]);
    if (reference.status === "expired" || (reference.expiresAt && reference.expiresAt < new Date().toISOString())) {
      throw new VaultAccessError("Secret reference expired", ["reference_expired"]);
    }
    if (reference.status === "missing" || reference.status === "unhealthy") {
      throw new VaultAccessError(`Secret reference ${reference.status}`, ["reference_unavailable"]);
    }
  }

  const leases = await getVaultAdapter().resolveForExecution(request, grant);
  recordAudit({
    actor: request.machineIdentity,
    action: "resolver.resolve",
    resource: grant.grantId,
    decision: "allow",
    source: "resolver",
    correlationId: grant.grantId,
    metadata: {
      runId: request.runId,
      provider: request.providerId,
      action: request.intendedAction,
      references: request.secretReferenceIds.join(","),
      leases: leases.length,
    },
  });
  return leases;
}

/** Releases every lease and revokes backend leases where applicable. */
export async function releaseLeases(leases: ResolvedSecretLease[]): Promise<void> {
  const adapter = getVaultAdapter();
  for (const lease of leases) {
    lease.release();
    await adapter.revokeLease(lease.leaseId, {
      organizationId: "system",
      projectId: "system",
      environment: "development",
      actor: "resolver",
    });
  }
}
