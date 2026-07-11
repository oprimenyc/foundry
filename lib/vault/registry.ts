import { randomUUID } from "crypto";
import { recordAudit } from "./audit";
import { VaultAccessError, type SecretReference, type VaultEnvironment } from "./types";

/**
 * Secret Reference registry: metadata-only control-plane index of every
 * secret the vault knows about. Values live exclusively in the backend
 * adapter; this registry can never hold one.
 */
const globalRefs = globalThis as unknown as { __primeVaultRefs?: Map<string, SecretReference> };
if (!globalRefs.__primeVaultRefs) globalRefs.__primeVaultRefs = new Map();
const references = globalRefs.__primeVaultRefs;

export interface VaultScope {
  organizationId: string;
  projectId: string;
  environment: VaultEnvironment;
  actor: string;
}

export function registerSecretReference(
  input: Omit<SecretReference, "id" | "uri" | "status"> & { status?: SecretReference["status"] }
): SecretReference {
  if ("value" in (input as Record<string, unknown>) || "plaintext" in (input as Record<string, unknown>)) {
    throw new VaultAccessError("SecretReference must never carry a value", ["reference_carries_value"]);
  }
  const id = `sref_${randomUUID()}`;
  const reference: SecretReference = {
    ...input,
    id,
    uri: `vault://${input.organizationId}/${input.projectId}/${input.environment}/${id}`,
    status: input.status ?? "available",
  };
  references.set(id, reference);
  recordAudit({
    actor: "vault-registry",
    action: "reference.register",
    resource: id,
    decision: "info",
    source: "registry",
    correlationId: id,
    metadata: { displayName: reference.displayName, environment: reference.environment },
  });
  return { ...reference };
}

function assertScope(reference: SecretReference, scope: VaultScope): void {
  const reasons: string[] = [];
  if (reference.organizationId !== scope.organizationId) reasons.push("cross_tenant_denied");
  if (reference.projectId !== scope.projectId) reasons.push("cross_project_denied");
  // A lower environment may never read a higher one's secret.
  const order: VaultEnvironment[] = ["development", "staging", "production"];
  if (order.indexOf(scope.environment) < order.indexOf(reference.environment)) {
    reasons.push("environment_escalation_denied");
  }
  if (reasons.length > 0) {
    recordAudit({
      actor: scope.actor,
      action: "reference.access",
      resource: reference.id,
      decision: "deny",
      source: "registry",
      correlationId: reference.id,
      metadata: { reasons: reasons.join(",") },
    });
    // Deny reads as nonexistence: no cross-tenant enumeration signal.
    throw new VaultAccessError(`Secret reference not found`, reasons);
  }
}

export function getSecretReference(referenceId: string, scope: VaultScope): SecretReference {
  const reference = references.get(referenceId);
  if (!reference) throw new VaultAccessError("Secret reference not found", ["unknown_reference"]);
  assertScope(reference, scope);
  return { ...reference };
}

export function listSecretReferences(scope: VaultScope): SecretReference[] {
  return Array.from(references.values())
    .filter(
      (reference) =>
        reference.organizationId === scope.organizationId && reference.projectId === scope.projectId
    )
    .map((reference) => ({ ...reference }));
}

/** All references in an org (admin/dashboard use — still metadata only). */
export function listOrganizationReferences(organizationId: string): SecretReference[] {
  return Array.from(references.values())
    .filter((reference) => reference.organizationId === organizationId)
    .map((reference) => ({ ...reference }));
}

export function updateSecretReferenceStatus(
  referenceId: string,
  status: SecretReference["status"],
  actor = "vault-registry"
): void {
  const reference = references.get(referenceId);
  if (!reference) throw new VaultAccessError("Secret reference not found", ["unknown_reference"]);
  reference.status = status;
  recordAudit({
    actor,
    action: "reference.status",
    resource: referenceId,
    decision: "info",
    source: "registry",
    correlationId: referenceId,
    metadata: { status },
  });
}

export function markReferenceUsed(referenceId: string): void {
  const reference = references.get(referenceId);
  if (reference) reference.lastUsedAt = new Date().toISOString();
}

/** Provider-eligible references for selection: availability answers only. */
export function findReferencesForProvider(
  providerId: string,
  scope: Pick<VaultScope, "organizationId" | "projectId" | "environment">
): SecretReference[] {
  return Array.from(references.values())
    .filter(
      (reference) =>
        reference.providerId === providerId &&
        reference.organizationId === scope.organizationId &&
        reference.projectId === scope.projectId &&
        reference.environment === scope.environment
    )
    .map((reference) => ({ ...reference }));
}

export function resetSecretReferences(): void {
  references.clear();
}
