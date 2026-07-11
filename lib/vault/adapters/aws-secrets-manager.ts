import { randomUUID } from "crypto";
import { redactError, registerSecretValue } from "../redaction";
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
 * AWS Secrets Manager adapter (interface-complete scaffold).
 *
 * Authentication: IAM machine role via the ambient AWS credential chain (or
 * an injected client for tests) — no keys hardcoded. Reference mapping:
 * SecretReference.uri ↔ secret ARN/name. Values are KMS-protected at rest by
 * AWS; this adapter only ever holds them in memory inside a lease. Rotation
 * metadata is surfaced from the backend's RotationEnabled/LastRotatedDate.
 * No live AWS credentials are required for unit tests: unconfigured
 * instances fail closed.
 */
export interface AwsSecretsClient {
  getSecretValue(input: { SecretId: string }): Promise<{ SecretString?: string; VersionId?: string }>;
  describeSecret(input: { SecretId: string }): Promise<{ RotationEnabled?: boolean; LastRotatedDate?: Date; NextRotationDate?: Date }>;
  rotateSecret(input: { SecretId: string }): Promise<{ VersionId?: string }>;
}

export class AwsSecretsManagerVaultAdapter implements VaultAdapter {
  readonly backend = "aws-secrets-manager";

  constructor(
    private readonly client?: AwsSecretsClient,
    private readonly config = { region: process.env.AWS_REGION, prefix: process.env.AWS_SECRETS_PREFIX || "foundry" }
  ) {}

  isConfigured(): boolean {
    return Boolean(this.client && this.config.region);
  }

  private arnFor(reference: SecretReference): string {
    // Deterministic name mapping: <prefix>/<project>/<environment>/<displayName>
    return `${this.config.prefix}/${reference.projectId}/${reference.environment}/${reference.displayName}`;
  }

  async listReferences(context: VaultScope): Promise<SecretReference[]> {
    return listSecretReferences(context);
  }

  async inspectReference(referenceId: string, context: VaultScope): Promise<SecretReference> {
    const reference = getSecretReference(referenceId, context);
    if (this.isConfigured()) {
      try {
        const meta = await this.client!.describeSecret({ SecretId: this.arnFor(reference) });
        if (meta.LastRotatedDate) reference.lastRotatedAt = meta.LastRotatedDate.toISOString();
        if (meta.RotationEnabled === false) reference.status = reference.status === "available" ? "rotation_due" : reference.status;
      } catch (error) {
        // Safe metadata failure: surfaced, never swallowed with values attached.
        throw new VaultAccessError(`AWS describeSecret failed: ${redactError(error).message}`, ["backend_error"]);
      }
    }
    return reference;
  }

  async validateAvailability(referenceId: string, context: VaultScope): Promise<VaultAvailability> {
    const reference = getSecretReference(referenceId, context);
    if (!this.isConfigured()) {
      return { referenceId, available: false, status: "unhealthy", detail: "AWS Secrets Manager backend not configured" };
    }
    return { referenceId, available: reference.status === "available", status: reference.status, detail: "metadata check" };
  }

  async resolveForExecution(request: VaultAccessRequest, grant: ExecutionGrant): Promise<ResolvedSecretLease[]> {
    if (!this.isConfigured()) {
      throw new VaultAccessError("AWS Secrets Manager backend not configured — refusing to resolve", ["backend_not_configured"]);
    }
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
      let value: string;
      try {
        const result = await this.client!.getSecretValue({ SecretId: this.arnFor(reference) });
        if (!result.SecretString) throw new VaultAccessError("Secret has no string value", ["backend_value_missing"]);
        value = result.SecretString;
      } catch (error) {
        if (error instanceof VaultAccessError) throw error;
        throw new VaultAccessError(`AWS getSecretValue failed: ${redactError(error).message}`, ["backend_error"]);
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
    // AWS SM has no server-side lease for GetSecretValue; local release suffices.
  }

  async rotateReference(referenceId: string, context: VaultScope): Promise<RotationResult> {
    if (!this.isConfigured()) {
      return { referenceId, rotated: false, detail: "backend not configured" };
    }
    const reference = getSecretReference(referenceId, context);
    try {
      const result = await this.client!.rotateSecret({ SecretId: this.arnFor(reference) });
      return { referenceId, rotated: true, newVersion: result.VersionId, detail: "rotation started via AWS Secrets Manager" };
    } catch (error) {
      return { referenceId, rotated: false, detail: redactError(error).message };
    }
  }

  async healthCheck(): Promise<VaultBackendHealth> {
    return {
      backend: this.backend,
      healthy: this.isConfigured(),
      detail: this.isConfigured() ? `configured (region ${this.config.region})` : "not configured (client/region missing)",
      checkedAt: new Date().toISOString(),
    };
  }
}
