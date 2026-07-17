export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "rolling_back"
  | "rolled_back";

export type FailureCategory =
  | "validation"
  | "provider"
  | "timeout"
  | "cancelled"
  | "rollback"
  | "internal";

export type RollbackStatus = "not_required" | "available" | "running" | "completed" | "failed";

// Provider identity is an open string resolved through the provider registries
// (lib/foundry/providers.ts) — Foundry never hardcodes a provider name here.
export type ProviderKind = string;
// Provider actions are an open string namespace validated fail-closed against
// each adapter's declared actions (validateDraftPlan) — the registry, not this
// type, is the gate, so new capability domains need no core type changes.
export type ProviderAction = string;

export interface ProjectRecord {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  prompt: string;
  status: "draft" | "active" | "failed" | "launched";
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentPlanStepRecord {
  id: string;
  provider: ProviderKind;
  /** Capability category (set when the step was authored provider-agnostically). */
  category?: string;
  action: ProviderAction;
  name: string;
  dependsOn: string[];
  config: Record<string, string | number | boolean | null | undefined>;
  timeoutMs: number;
  retryLimit: number;
  rollbackAction?: ProviderAction;
  approvalRequired?: boolean;
}

export interface DeploymentPlanRecord {
  id: string;
  projectId: string;
  prompt: string;
  status: "validated" | "rejected";
  config: {
    name: string;
    hosting: string;
    repository: string;
  };
  budget: {
    maxSteps: number;
    maxRuntimeMs: number;
  };
  steps: DeploymentPlanStepRecord[];
  validationErrors: string[];
  createdAt: string;
}

export interface ProviderCredentialReferenceRecord {
  id: string;
  orgId: string;
  projectId?: string;
  provider: ProviderKind;
  purpose: string;
  encryptedSecret: {
    iv: string;
    content: string;
    tag: string;
    wrappedDek: string;
  };
  keyVersion: number;
  createdAt: string;
  rotatedAt?: string;
}

export interface RollbackActionRecord {
  id: string;
  runId: string;
  stepId: string;
  provider: ProviderKind;
  action: ProviderAction;
  providerReference?: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface DeploymentStepRecord {
  id: string;
  runId: string;
  planStepId: string;
  provider: ProviderKind;
  action: ProviderAction;
  status: "queued" | "running" | "completed" | "failed" | "rolled_back";
  startedAt?: string;
  completedAt?: string;
  providerReference?: string;
  output?: Record<string, unknown>;
  rollbackActionId?: string;
  retryCount: number;
  error?: string;
}

export interface ExecutionEventRecord {
  id: string;
  runId: string;
  projectId: string;
  stepId?: string;
  sequence: number;
  timestamp: string;
  stage: "run" | "step" | "verification" | "rollback";
  status: RunStatus | "info";
  sanitizedMessage: string;
  provider?: ProviderKind;
  evidenceReference?: string;
}

export interface LaunchEvidenceRecord {
  id: string;
  runId: string;
  claims: string[];
  evidence: Array<{ key: string; value: string }>;
  result: "passed" | "failed";
  createdAt: string;
  verifiedAt: string;
  verifierVersion: string;
}

export interface SignedEvidenceManifestRecord {
  id: string;
  manifestVersion: "foundry-evidence-manifest@1";
  executionId: string;
  tenantId: string;
  capabilityId: string;
  producerIdentity: string;
  executionTimestamp: string;
  evidenceItems: Array<{
    evidenceId: string;
    reference: string;
    hash: string;
    type: string;
  }>;
  manifestHash: string;
  signatureAlgorithm: "HMAC-SHA256" | "RSASSA-PSS-SHA256";
  signerProvider: string;
  signerKeyId: string;
  signerKeyVersion: string;
  signature: string;
  issuedAt: string;
}

export interface DeploymentRunRecord {
  id: string;
  projectId: string;
  planId: string;
  status: RunStatus;
  currentStep?: string;
  progress: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failureCategory?: FailureCategory;
  sanitizedFailureMessage?: string;
  retryCount: number;
  idempotencyKey: string;
  rollbackStatus: RollbackStatus;
  providerReferences: Record<string, string>;
  evidenceReferences: string[];
  requestedBy?: string;
  terminalState?: "success" | "failure" | "cancelled" | "rolled_back";
  cancellationRequestedAt?: string;
}

/**
 * Independent verification result. Strictly separate from adapter execution
 * results and Foundry run status: a run is never "externally verified" merely
 * because its own adapter returned success. E.V.E. or any external verifier
 * consumes/produces these records.
 */
export interface VerificationRecord {
  id: string;
  runId: string;
  target: { kind: "deployment_url" | "repository_url"; reference: string };
  status: "passed" | "failed";
  detail: string;
  attempt: number;
  checkedAt: string;
  verifierVersion: string;
}

export type OperationalIncidentSeverity = "low" | "medium" | "high" | "critical";
export type OperationalIncidentStatus = "open" | "monitoring" | "resolved";

export interface OperationalIncidentRecord {
  id: string;
  scope: "provider" | "credential" | "deployment" | "service" | "environment" | "dependency";
  status: OperationalIncidentStatus;
  severity: OperationalIncidentSeverity;
  summary: string;
  providerId?: string;
  credentialReferenceId?: string;
  projectIds: string[];
  dependencies: string[];
  impact: string;
  recommendedActions: string[];
  rollbackPlan: string[];
  evidence: Array<{ key: string; value: string }>;
  source: "manual" | "derived";
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface OperationEvidenceRecord {
  id: string;
  operation: string;
  actor: string;
  scope: "provider" | "credential" | "incident" | "dependency" | "environment" | "approval" | "rollback" | "runtime";
  status: "passed" | "failed" | "warning" | "info";
  timestamp: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  verification: string[];
  runtimeProof: string[];
  residualRisk: string[];
  relatedRunId?: string;
  relatedIncidentId?: string;
}

/**
 * Retention class governs how long a retained artifact is kept and whether it
 * is immutable. RELEASE/AUDIT/LEGAL_HOLD artifacts are immutable by construction.
 */
export type RetentionClass = "EPHEMERAL" | "STANDARD" | "RELEASE" | "AUDIT" | "LEGAL_HOLD";

export interface ArtifactRecord {
  /** Deterministic, content-addressed: `art_<sha256-prefix>`. */
  id: string;
  runId?: string;
  projectId?: string;
  envelopeId?: string;
  /** e.g. execution_envelope | plan | provider_response | evidence | rollback | log. */
  kind: string;
  contentType: string;
  /** sha256 hex of the stored (already-redacted) content. */
  checksum: string;
  sizeBytes: number;
  /** Storage adapter URI, e.g. file://.foundry-data/artifacts/<sha>.json */
  storageUri: string;
  retentionClass: RetentionClass;
  immutable: boolean;
  redacted: boolean;
  provenance: { producer: string; source: string; createdFrom?: string };
  createdAt: string;
  /** Absent for AUDIT/LEGAL_HOLD (kept indefinitely). */
  expiresAt?: string;
}

export type ApprovalGateStatus = "pending" | "approved" | "rejected" | "expired" | "deferred";

/**
 * A persisted human gate. Unlike the in-memory vault approvals, this survives
 * restart so a paused run can resume at the exact step after a human decides.
 */
export interface ApprovalGateRecord {
  id: string;
  runId: string;
  projectId: string;
  planStepId: string;
  provider: ProviderKind;
  action: ProviderAction;
  riskLevel: "low" | "moderate" | "high" | "critical";
  /** Why a human is required (fail-closed, human-readable, secret-free). */
  reason: string;
  /** What the human must do before approving. */
  requiredAction: string;
  status: ApprovalGateStatus;
  createdAt: string;
  expiresAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

export interface FoundryStore {
  projects: ProjectRecord[];
  plans: DeploymentPlanRecord[];
  runs: DeploymentRunRecord[];
  steps: DeploymentStepRecord[];
  credentials: ProviderCredentialReferenceRecord[];
  events: ExecutionEventRecord[];
  rollbacks: RollbackActionRecord[];
  evidence: LaunchEvidenceRecord[];
  evidenceManifests: SignedEvidenceManifestRecord[];
  verifications: VerificationRecord[];
  incidents: OperationalIncidentRecord[];
  operations: OperationEvidenceRecord[];
  artifacts: ArtifactRecord[];
  approvalGates: ApprovalGateRecord[];
}
