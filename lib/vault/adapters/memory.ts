import { randomUUID } from "crypto";
import { registerSecretValue } from "../redaction";
import { getSecretReference, listSecretReferences, markReferenceUsed, type VaultScope } from "../registry";
import {
  VaultAccessError,
  type ExecutionGrant,
  type ResolvedSecretLease,
  type RotationResult,
  type SecretReference,
  type VaultAccessRequest,
  type VaultAvailability,
  type VaultBackendHealth,
} from "../types";
import type { VaultAdapter } from "./interface";

/**
 * In-memory development adapter. REFUSES to operate in production — the
 * production path must be a real secret engine (Infisical/OpenBao/AWS).
 * Values live only in process memory keyed by reference id.
 */
export class MemoryVaultAdapter implements VaultAdapter {
  readonly backend = "memory";
  private values = new Map<string, string>();
  private leases = new Map<string, ResolvedSecretLease>();

  constructor() {
    this.assertNotProduction();
  }

  private assertNotProduction(): void {
    if (process.env.NODE_ENV === "production") {
      throw new VaultAccessError(
        "MemoryVaultAdapter is a development-only backend and refuses to start in production",
        ["memory_adapter_forbidden_in_production"]
      );
    }
  }

  /** Dev/test seeding: value goes straight into the taint registry too. */
  seedValue(referenceId: string, value: string): void {
    this.assertNotProduction();
    this.values.set(referenceId, value);
    registerSecretValue(value);
  }

  async listReferences(context: VaultScope): Promise<SecretReference[]> {
    return listSecretReferences(context);
  }

  async inspectReference(referenceId: string, context: VaultScope): Promise<SecretReference> {
    return getSecretReference(referenceId, context);
  }

  async validateAvailability(referenceId: string, context: VaultScope): Promise<VaultAvailability> {
    const reference = getSecretReference(referenceId, context);
    const hasValue = this.values.has(referenceId);
    const available = reference.status === "available" && hasValue;
    return {
      referenceId,
      available,
      status: hasValue ? reference.status : "missing",
      detail: available ? "reference available" : `reference ${hasValue ? reference.status : "missing"}`,
    };
  }

  async resolveForExecution(request: VaultAccessRequest, grant: ExecutionGrant): Promise<ResolvedSecretLease[]> {
    this.assertNotProduction();
    const leases: ResolvedSecretLease[] = [];
    for (const referenceId of request.secretReferenceIds) {
      if (!grant.allowedSecretReferenceIds.includes(referenceId)) {
        throw new VaultAccessError("Reference not covered by grant", ["grant_reference_not_allowed"]);
      }
      const value = this.values.get(referenceId);
      if (value === undefined) throw new VaultAccessError("Secret value missing in backend", ["backend_value_missing"]);
      registerSecretValue(value);
      let plaintext: string | undefined = value;
      const lease: ResolvedSecretLease = {
        leaseId: `lease_${randomUUID()}`,
        referenceId,
        grantId: grant.grantId,
        expiresAt: grant.expiresAt,
        released: false,
        read() {
          if (this.released || plaintext === undefined) {
            throw new VaultAccessError("Lease released", ["lease_released"]);
          }
          return plaintext;
        },
        release() {
          plaintext = undefined;
          this.released = true;
        },
      };
      this.leases.set(lease.leaseId, lease);
      markReferenceUsed(referenceId);
      leases.push(lease);
    }
    return leases;
  }

  async revokeLease(leaseId: string): Promise<void> {
    this.leases.get(leaseId)?.release();
    this.leases.delete(leaseId);
  }

  async rotateReference(referenceId: string): Promise<RotationResult> {
    this.assertNotProduction();
    if (!this.values.has(referenceId)) {
      return { referenceId, rotated: false, detail: "no value to rotate" };
    }
    const rotated = `rotated_${randomUUID()}`;
    this.values.set(referenceId, rotated);
    registerSecretValue(rotated);
    return { referenceId, rotated: true, newVersion: new Date().toISOString(), detail: "rotated in memory backend" };
  }

  async healthCheck(): Promise<VaultBackendHealth> {
    return {
      backend: this.backend,
      healthy: process.env.NODE_ENV !== "production",
      detail: process.env.NODE_ENV === "production" ? "memory backend forbidden in production" : "memory backend ready (dev/test only)",
      checkedAt: new Date().toISOString(),
    };
  }
}
