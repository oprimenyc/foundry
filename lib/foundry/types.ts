export type RunStatus =
  | "queued"
  | "running"
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

export interface FoundryStore {
  projects: ProjectRecord[];
  plans: DeploymentPlanRecord[];
  runs: DeploymentRunRecord[];
  steps: DeploymentStepRecord[];
  credentials: ProviderCredentialReferenceRecord[];
  events: ExecutionEventRecord[];
  rollbacks: RollbackActionRecord[];
  evidence: LaunchEvidenceRecord[];
  verifications: VerificationRecord[];
}
