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
 * Infisical adapter (production-ready scaffold).
 *
 * Authentication: Machine Identity (Universal Auth client id/secret) read
 * from environment at call time — never hardcoded, never logged. Reference
 * mapping: SecretReference.uri path maps to Infisical
 * project/environment/secret-path. Infisical-specific types stay inside this
 * file. Without live configuration every resolution fails closed with a safe
 * error; unit tests never need a live server.
 */
interface InfisicalConfig {
  baseUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  projectId?: string;
}

export class InfisicalVaultAdapter implements VaultAdapter {
  readonly backend = "infisical";
  private accessToken?: { token: string; expiresAt: number };

  constructor(
    private readonly config: InfisicalConfig = {
      baseUrl: process.env.INFISICAL_BASE_URL || "https://app.infisical.com",
      clientIdEnv: "INFISICAL_CLIENT_ID",
      clientSecretEnv: "INFISICAL_CLIENT_SECRET",
      projectId: process.env.INFISICAL_PROJECT_ID,
    },
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  isConfigured(): boolean {
    return Boolean(process.env[this.config.clientIdEnv] && process.env[this.config.clientSecretEnv] && this.config.projectId);
  }

  /** Machine-identity login. Token held in memory with expiry, never logged. */
  private async authenticate(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000) return this.accessToken.token;
    const clientId = process.env[this.config.clientIdEnv];
    const clientSecret = process.env[this.config.clientSecretEnv];
    if (!clientId || !clientSecret) {
      throw new VaultAccessError("Infisical machine identity is not configured", ["backend_not_configured"]);
    }
    const response = await this.fetchImpl(`${this.config.baseUrl}/api/v1/auth/universal-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!response.ok) throw new VaultAccessError(`Infisical authentication failed (${response.status})`, ["backend_auth_failed"]);
    const data = (await response.json()) as { accessToken: string; expiresIn: number };
    this.accessToken = { token: data.accessToken, expiresAt: Date.now() + data.expiresIn * 1000 };
    registerSecretValue(data.accessToken);
    return data.accessToken;
  }

  async listReferences(context: VaultScope): Promise<SecretReference[]> {
    // Control-plane metadata comes from the local reference registry; the
    // backend is consulted only for values and availability.
    return listSecretReferences(context);
  }

  async inspectReference(referenceId: string, context: VaultScope): Promise<SecretReference> {
    return getSecretReference(referenceId, context);
  }

  async validateAvailability(referenceId: string, context: VaultScope): Promise<VaultAvailability> {
    const reference = getSecretReference(referenceId, context);
    if (!this.isConfigured()) {
      return { referenceId, available: false, status: "unhealthy", detail: "Infisical backend not configured" };
    }
    return { referenceId, available: reference.status === "available", status: reference.status, detail: "metadata check (live probe on resolve)" };
  }

  async resolveForExecution(request: VaultAccessRequest, grant: ExecutionGrant): Promise<ResolvedSecretLease[]> {
    if (!this.isConfigured()) {
      throw new VaultAccessError("Infisical backend not configured — refusing to resolve", ["backend_not_configured"]);
    }
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
      // Opaque reference → Infisical path: /api/v3/secrets/raw/<name>
      const secretName = reference.displayName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      const url = `${this.config.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}?workspaceId=${this.config.projectId}&environment=${reference.environment}`;
      let value: string;
      try {
        const response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new VaultAccessError(`Infisical secret fetch failed (${response.status})`, ["backend_fetch_failed"]);
        const data = (await response.json()) as { secret: { secretValue: string } };
        value = data.secret.secretValue;
      } catch (error) {
        if (error instanceof VaultAccessError) throw error;
        throw new VaultAccessError(`Infisical backend error: ${redactError(error).message}`, ["backend_error"]);
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
      markReferenceUsed(referenceId);
      leases.push(lease);
    }
    return leases;
  }

  async revokeLease(): Promise<void> {
    // Infisical raw reads are not leased server-side; local release suffices.
  }

  async healthCheck(): Promise<VaultBackendHealth> {
    if (!this.isConfigured()) {
      return { backend: this.backend, healthy: false, detail: "not configured (INFISICAL_CLIENT_ID/SECRET/PROJECT_ID)", checkedAt: new Date().toISOString() };
    }
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/api/status`);
      return { backend: this.backend, healthy: response.ok, detail: `status ${response.status}`, checkedAt: new Date().toISOString() };
    } catch (error) {
      return { backend: this.backend, healthy: false, detail: redactError(error).message, checkedAt: new Date().toISOString() };
    }
  }
}
