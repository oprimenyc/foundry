import { randomUUID } from "crypto";
import { redactError, registerSecretValue } from "../redaction";
import { getSecretReference, listSecretReferences, markReferenceUsed, type VaultScope } from "../registry";
import {
  VaultAccessError,
  type ExecutionGrant,
  type ResolvedSecretLease,
  type SecretReference,
  type VaultAccessRequest,
  type VaultAvailability,
  type VaultBackendHealth,
} from "../types";
import type { VaultAdapter } from "./interface";

/**
 * OpenBao / HashiCorp Vault adapter (interface-complete scaffold).
 *
 * Authentication: AppRole (role_id/secret_id from env at call time). Supports
 * KV v2 reads and dynamic secrets (database/cloud engines) — dynamic reads
 * return a backend lease_id which this adapter tracks and revokes via
 * /sys/leases/revoke. No live server is required for unit tests: unconfigured
 * instances fail closed with safe errors.
 */
export class OpenBaoVaultAdapter implements VaultAdapter {
  readonly backend = "openbao";
  private clientToken?: string;
  private backendLeases = new Map<string, string>(); // leaseId -> backend lease_id

  constructor(
    private readonly config = {
      baseUrl: process.env.OPENBAO_ADDR || process.env.VAULT_ADDR || "",
      roleIdEnv: "OPENBAO_ROLE_ID",
      secretIdEnv: "OPENBAO_SECRET_ID",
      kvMount: process.env.OPENBAO_KV_MOUNT || "secret",
    },
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.baseUrl && process.env[this.config.roleIdEnv] && process.env[this.config.secretIdEnv]);
  }

  private async authenticate(): Promise<string> {
    if (this.clientToken) return this.clientToken;
    if (!this.isConfigured()) throw new VaultAccessError("OpenBao backend not configured", ["backend_not_configured"]);
    const response = await this.fetchImpl(`${this.config.baseUrl}/v1/auth/approle/login`, {
      method: "POST",
      body: JSON.stringify({ role_id: process.env[this.config.roleIdEnv], secret_id: process.env[this.config.secretIdEnv] }),
    });
    if (!response.ok) throw new VaultAccessError(`OpenBao AppRole login failed (${response.status})`, ["backend_auth_failed"]);
    const data = (await response.json()) as { auth: { client_token: string } };
    this.clientToken = data.auth.client_token;
    registerSecretValue(this.clientToken);
    return this.clientToken;
  }

  async listReferences(context: VaultScope): Promise<SecretReference[]> {
    return listSecretReferences(context);
  }

  async inspectReference(referenceId: string, context: VaultScope): Promise<SecretReference> {
    return getSecretReference(referenceId, context);
  }

  async validateAvailability(referenceId: string, context: VaultScope): Promise<VaultAvailability> {
    const reference = getSecretReference(referenceId, context);
    if (!this.isConfigured()) {
      return { referenceId, available: false, status: "unhealthy", detail: "OpenBao backend not configured" };
    }
    return { referenceId, available: reference.status === "available", status: reference.status, detail: "metadata check" };
  }

  async resolveForExecution(request: VaultAccessRequest, grant: ExecutionGrant): Promise<ResolvedSecretLease[]> {
    const token = await this.authenticate();
    const leases: ResolvedSecretLease[] = [];
    for (const referenceId of request.secretReferenceIds) {
      if (!grant.allowedSecretReferenceIds.includes(referenceId)) {
        throw new VaultAccessError("Reference not covered by grant", ["grant_reference_not_allowed"]);
      }
      const reference = getSecretReference(referenceId, {
        organizationId: request.organizationId,
        projectId: request.projectId,
        environment: request.environment,
        actor: request.machineIdentity,
      });
      // KV v2 path: <mount>/data/<project>/<environment>/<name>
      const path = `${this.config.kvMount}/data/${reference.projectId}/${reference.environment}/${reference.displayName}`;
      let value: string;
      let backendLeaseId: string | undefined;
      try {
        const response = await this.fetchImpl(`${this.config.baseUrl}/v1/${path}`, { headers: { "X-Vault-Token": token } });
        if (!response.ok) throw new VaultAccessError(`OpenBao read failed (${response.status})`, ["backend_fetch_failed"]);
        const data = (await response.json()) as { lease_id?: string; data: { data: Record<string, string> } };
        backendLeaseId = data.lease_id || undefined; // set for dynamic secrets
        value = data.data.data.value;
      } catch (error) {
        if (error instanceof VaultAccessError) throw error;
        throw new VaultAccessError(`OpenBao backend error: ${redactError(error).message}`, ["backend_error"]);
      }
      registerSecretValue(value);
      let plaintext: string | undefined = value;
      const lease: ResolvedSecretLease = {
        leaseId: `lease_${randomUUID()}`,
        referenceId,
        grantId: grant.grantId,
        expiresAt: grant.expiresAt,
        released: false,
        read() {
          if (this.released || plaintext === undefined) throw new VaultAccessError("Lease released", ["lease_released"]);
          return plaintext;
        },
        release() {
          plaintext = undefined;
          this.released = true;
        },
      };
      if (backendLeaseId) this.backendLeases.set(lease.leaseId, backendLeaseId);
      markReferenceUsed(referenceId);
      leases.push(lease);
    }
    return leases;
  }

  /** Revokes the backend lease (dynamic secrets) and releases locally. */
  async revokeLease(leaseId: string): Promise<void> {
    const backendLeaseId = this.backendLeases.get(leaseId);
    if (backendLeaseId && this.isConfigured() && this.clientToken) {
      try {
        await this.fetchImpl(`${this.config.baseUrl}/v1/sys/leases/revoke`, {
          method: "PUT",
          headers: { "X-Vault-Token": this.clientToken },
          body: JSON.stringify({ lease_id: backendLeaseId }),
        });
      } catch (error) {
        throw new VaultAccessError(`OpenBao lease revocation failed: ${redactError(error).message}`, ["lease_revoke_failed"]);
      }
    }
    this.backendLeases.delete(leaseId);
  }

  async healthCheck(): Promise<VaultBackendHealth> {
    if (!this.isConfigured()) {
      return { backend: this.backend, healthy: false, detail: "not configured (OPENBAO_ADDR/ROLE_ID/SECRET_ID)", checkedAt: new Date().toISOString() };
    }
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/v1/sys/health`);
      return { backend: this.backend, healthy: response.ok, detail: `status ${response.status}`, checkedAt: new Date().toISOString() };
    } catch (error) {
      return { backend: this.backend, healthy: false, detail: redactError(error).message, checkedAt: new Date().toISOString() };
    }
  }

  /** Randomness kept out of module scope for testability. */
  static newLeaseId(): string {
    return `lease_${randomUUID()}`;
  }
}
