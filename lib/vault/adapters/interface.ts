import type {
  ExecutionGrant,
  ResolvedSecretLease,
  RotationResult,
  SecretReference,
  VaultAccessRequest,
  VaultAvailability,
  VaultBackendHealth,
} from "../types";
import type { VaultScope } from "../registry";

/**
 * Vault adapter contract. `resolveForExecution` may be called ONLY by the
 * trusted server-side resolver (lib/vault/resolver.ts) — never by client
 * APIs, dashboard loaders, planner/LLM tools, or E.V.E.
 *
 * Resolved values: memory-only, never persisted, never logged, never placed
 * in evidence or errors, released after use.
 */
export interface VaultAdapter {
  readonly backend: string;
  listReferences(context: VaultScope): Promise<SecretReference[]>;
  inspectReference(referenceId: string, context: VaultScope): Promise<SecretReference>;
  validateAvailability(referenceId: string, context: VaultScope): Promise<VaultAvailability>;
  resolveForExecution(request: VaultAccessRequest, grant: ExecutionGrant): Promise<ResolvedSecretLease[]>;
  revokeLease(leaseId: string, context: VaultScope): Promise<void>;
  rotateReference?(referenceId: string, context: VaultScope): Promise<RotationResult>;
  healthCheck(): Promise<VaultBackendHealth>;
}
