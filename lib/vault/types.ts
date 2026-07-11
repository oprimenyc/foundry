import type { ProviderCategory } from "@/lib/foundry/universal/types";

/**
 * Prime Vault domain model.
 *
 * The vault is a CONTROL PLANE over established secret backends (Infisical,
 * OpenBao/Vault, AWS Secrets Manager, in-memory dev). It never implements
 * cryptographic primitives and never stores production plaintext in the
 * application database. Everything outside the trusted resolver sees
 * REFERENCES and safe metadata only.
 */

export type VaultEnvironment = "development" | "staging" | "production";

export type SecretReferenceStatus =
  | "available"
  | "missing"
  | "expired"
  | "rotation_due"
  | "revoked"
  | "unhealthy";

/** Metadata-only handle to a secret. MUST never carry a value field. */
export type SecretReference = {
  id: string;
  /** Opaque backend URI, e.g. vault://memory/org/proj/production/dns-token */
  uri: string;
  organizationId: string;
  projectId: string;
  environment: VaultEnvironment;
  providerId?: string;
  category?: ProviderCategory;
  displayName: string;
  capabilities: string[];
  status: SecretReferenceStatus;
  requiresApproval: boolean;
  lastUsedAt?: string;
  lastRotatedAt?: string;
  expiresAt?: string;
  version?: string;
};

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export interface VaultAccessRequest {
  requestId: string;
  organizationId: string;
  projectId: string;
  environment: VaultEnvironment;
  /** Machine identity of the requesting service (never a human password). */
  machineIdentity: string;
  runId: string;
  capability: string;
  providerId: string;
  targetResource: string;
  intendedAction: string;
  secretReferenceIds: string[];
  estimatedCostUsd: number;
  riskLevel: RiskLevel;
  requestedDurationMs: number;
  requestedAt: string;
}

export type ApprovalMode =
  | "deny"
  | "allow_once"
  | "allow_for_run"
  | "allow_until"
  | "allow_recurring_policy"
  | "require_manual_approval";

export interface VaultAccessDecision {
  allow: boolean;
  scopesGranted: string[];
  approvalSource: "policy" | "manual" | "standing" | "none";
  approvalId?: string;
  policyVersion: string;
  maxDurationMs: number;
  maxUses: number;
  reasonCodes: string[];
  denialReasons: string[];
  auditCorrelationId: string;
}

/**
 * ExecutionGrant is NOT a secret. It is a short-lived, scoped, revocable,
 * fail-closed authorization letting the trusted server-side executor resolve
 * specific references for one approved action. Unusable by browsers or other
 * runs by construction (validated server-side against run + provider + action).
 */
export interface ExecutionGrant {
  grantId: string;
  runId: string;
  allowedSecretReferenceIds: string[];
  allowedProviderId: string;
  allowedCapabilities: string[];
  allowedAction: string;
  targetConstraints: string[];
  issuedAt: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revoked: boolean;
  revokedReason?: string;
  approvalId?: string;
  /** "forward" grants never authorize rollback; rollback needs its own scope. */
  scope: "forward" | "rollback";
}

export interface ApprovalRequest {
  approvalId: string;
  request: VaultAccessRequest;
  mode: ApprovalMode;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedBy?: string;
  decidedAt?: string;
  /** For allow_until / standing approvals. */
  validUntil?: string;
  note?: string;
}

export interface VaultAvailability {
  referenceId: string;
  available: boolean;
  status: SecretReferenceStatus;
  detail: string;
}

export interface VaultBackendHealth {
  backend: string;
  healthy: boolean;
  detail: string;
  checkedAt: string;
}

export interface RotationResult {
  referenceId: string;
  rotated: boolean;
  newVersion?: string;
  detail: string;
}

/**
 * A resolved secret lease. `read()` yields the plaintext exactly while inside
 * the trusted executor; `release()` dereferences it. The value must never be
 * persisted, logged, serialized, or placed in evidence/errors.
 */
export interface ResolvedSecretLease {
  leaseId: string;
  referenceId: string;
  grantId: string;
  expiresAt: string;
  read(): string;
  release(): void;
  released: boolean;
}

export interface VaultAuditEvent {
  id: string;
  actor: string;
  action: string;
  resource: string;
  decision: "allow" | "deny" | "info";
  timestamp: string;
  source: string;
  correlationId: string;
  /** Reference IDs only — never secret values. Redacted at write time. */
  metadata: Record<string, string | number | boolean>;
}

export class VaultAccessError extends Error {
  constructor(message: string, public readonly reasonCodes: string[] = []) {
    // Vault errors are safe by construction: reason codes, never values.
    super(message);
    this.name = "VaultAccessError";
  }
}
