import { z } from "zod";
import { scanForRawSecretMaterial, isValidSecretFingerprint } from "@/lib/secret-remediation/secret-scan";

/**
 * Foundry Provider Action Contract — provider-neutral (mission: provider
 * action adapter mega run).
 *
 * Same design rule as lib/secret-remediation/types.ts and
 * lib/local-execution/types.ts: this contract prepares, validates, and
 * evidences a *future* live provider action (credential revoke/rotate,
 * deployment env update, restart/redeploy, health verification, DNS/git-
 * history advisories) — it never performs one. No adapter in this module
 * (lib/provider-actions/adapters/*) ever makes a live HTTP call, touches a
 * provider SDK, or accepts a live-mode escape hatch. That capability simply
 * does not exist yet anywhere in this module, by design — see the mission's
 * "no live provider calls" constraint.
 *
 * Hard rule enforced by the schema itself: raw secret material is never
 * accepted anywhere in a submission (target descriptions, notes, source
 * references, ...) — mirrors lib/secret-remediation/types.ts's superRefine.
 */

export const PROVIDER_TYPES = ["github", "database", "google_oauth", "nextauth", "railway", "fly", "vercel", "generic_env"] as const;
export type ProviderActionProviderType = (typeof PROVIDER_TYPES)[number];

export const ACTION_TYPES = [
  "revoke_credential",
  "rotate_credential",
  "update_deployment_env_var",
  "restart_service",
  "redeploy_service",
  "verify_service_health",
  "git_history_rewrite_advisory",
  "dns_advisory",
] as const;
export type ProviderActionType = (typeof ACTION_TYPES)[number];

/** Action types that never mutate anything even in principle — always advisory or read-only. */
export const NON_MUTATING_ACTION_TYPES: readonly ProviderActionType[] = ["verify_service_health"];
/** Action types that are permanently advisory-only in this codebase — no live executor exists or is planned here. */
export const PERMANENTLY_ADVISORY_ACTION_TYPES: readonly ProviderActionType[] = ["git_history_rewrite_advisory", "dns_advisory"];

export const TARGET_ENVIRONMENTS = ["development", "staging", "production"] as const;
export type TargetEnvironment = (typeof TARGET_ENVIRONMENTS)[number];

export const MUTATION_RISK_LEVELS = ["none", "low", "medium", "high", "critical"] as const;
export type MutationRisk = (typeof MUTATION_RISK_LEVELS)[number];

export const PROVIDER_ACTION_VERDICTS = ["PASS", "FAIL", "BLOCKED", "PASS_WITH_WARNINGS"] as const;
export type ProviderActionVerdict = (typeof PROVIDER_ACTION_VERDICTS)[number];

/**
 * Replit ecosystem classification (mission: Replit deployment target scrub).
 * Replit is never a value in PROVIDER_TYPES above and never will be — it has
 * no live-executor path anywhere in this module, exactly like every other
 * provider here, but it additionally must never even be *advised* as a
 * production/staging deployment target. Where a project's only current host
 * happens to be Replit, this optional field lets a submission record that
 * fact honestly (dev-stack provenance) without it reading as a
 * recommendation to keep deploying there.
 */
export const REPLIT_CLASSIFICATION_STATUSES = ["not_applicable", "dev_stack_origin_only", "scrub_required"] as const;
export type ReplitClassificationStatus = (typeof REPLIT_CLASSIFICATION_STATUSES)[number];
export const REPLIT_DEPLOYMENT_TARGET_STATUSES = ["undecided", "non_replit_required", "approved_non_replit_selected"] as const;
export type ReplitDeploymentTargetStatus = (typeof REPLIT_DEPLOYMENT_TARGET_STATUSES)[number];

/** Every human-only approval reason this module can require. Foundry only prepares; a human decides every one of these. */
export const PROVIDER_ACTION_GATE_REASONS = [
  "live_provider_mutation",
  "credential_revocation",
  "credential_rotation",
  "deployment_env_mutation",
  "restart_redeploy",
  "production_target",
  "git_history_rewrite",
  "force_push",
  "dns_mutation",
] as const;
export type ProviderActionGateReason = (typeof PROVIDER_ACTION_GATE_REASONS)[number];

function rawSecretRefinement(value: unknown, ctx: z.RefinementCtx) {
  for (const match of scanForRawSecretMaterial(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `raw secret-shaped material detected in "${match.field}" — provider action submissions never carry secret values`,
      path: match.field === "(root)" ? [] : match.field.split("."),
    });
  }
}

export const ProviderActionRequestInputSchema = z
  .object({
    /** Project/repo this action targets (e.g. "panticandy", "vitalcore", "dyln", "primeopp"). Never a repo this mission may write to. */
    project: z.string().min(1),
    providerType: z.enum(PROVIDER_TYPES),
    actionType: z.enum(ACTION_TYPES),
    targetEnvironment: z.enum(TARGET_ENVIRONMENTS),
    /** Free-text description of the specific target (e.g. "PantiCandy CI GitHub PAT") — never a credential value. */
    targetDescription: z.string().min(1),
    /** Only meaningful for git_history_rewrite_advisory; a rewrite that also requires a force-push needs its own, separate approval gate. */
    forcePushRequired: z.boolean().default(false),
    rollbackPlan: z.array(z.string().min(1)).min(1),
    verificationPlan: z.array(z.string().min(1)).min(1),
    /** Gate reasons the submitter asserts were already decided out-of-band (e.g. a prior ops review) — never trusted blindly; still recorded as an approved gate record, auditable like any other decision. */
    preApprovedGateReasons: z.array(z.enum(PROVIDER_ACTION_GATE_REASONS)).default([]),
    /** Known missing local prerequisites (e.g. "vercel-cli") an adapter can check itself against. Never a credential. */
    knownPrerequisiteGaps: z.array(z.string().min(1)).default([]),
    /** Commit hash, file path, or config key — never a secret value. */
    sourceReference: z.string().min(1).optional(),
    secretFingerprint: z
      .string()
      .refine(isValidSecretFingerprint, { message: 'secretFingerprint must be a "sha256:<64 hex chars>" hash, never a raw value' })
      .optional(),
    notes: z.string().max(2000).optional(),
    /** See REPLIT_CLASSIFICATION_STATUSES doc comment above — never implies Replit is an approved deployment target. */
    replitClassification: z
      .object({
        status: z.enum(REPLIT_CLASSIFICATION_STATUSES),
        deploymentTargetStatus: z.enum(REPLIT_DEPLOYMENT_TARGET_STATUSES),
        explanation: z.string().min(1),
      })
      .optional(),
  })
  .superRefine(rawSecretRefinement);
export type ProviderActionRequestInput = z.infer<typeof ProviderActionRequestInputSchema>;

export interface ProviderActionRequest extends ProviderActionRequestInput {
  id: string;
  mutationRisk: MutationRisk;
  createdAt: string;
}

export type ProviderActionGateStatus = "pending" | "approved" | "rejected";

export interface ProviderActionGateRecord {
  id: string;
  actionId: string;
  reason: ProviderActionGateReason;
  status: ProviderActionGateStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

/** One provider-classification-aware advisory. Always dry-run: never mutates provider state. */
export interface ProviderActionAdvisory {
  adapterId: string;
  providerType: ProviderActionProviderType;
  actionType: ProviderActionType;
  actionThatWouldBeTaken: string;
  requiredCredentials: string[];
  requiredApproval: ProviderActionGateReason[];
  /** Always true: this adapter never performs the action itself. */
  mutationDisabled: true;
  /** Always false: asserts (rather than merely claims) that no live call was made. */
  liveCallMade: false;
  verificationSteps: string[];
  rollbackSteps: string[];
  evidenceRefs: string[];
  prerequisiteMet: boolean;
  blockedReason?: string;
}

/** "block" -> unreviewable / cannot proceed (BLOCKED). "warning" -> PASS_WITH_WARNINGS. Nothing here reaches "blocking"/FAIL: a well-formed provider action plan is either awaiting/missing approval (BLOCKED) or advisory-complete (PASS/PASS_WITH_WARNINGS) — schema validation already rejects structurally incomplete submissions before policy ever runs. */
export type ProviderActionFindingSeverity = "block" | "warning";

export interface ProviderActionPolicyFinding {
  code: string;
  severity: ProviderActionFindingSeverity;
  message: string;
}

export interface ProviderActionPolicyEvaluation {
  requiredApprovalGates: ProviderActionGateReason[];
  findings: ProviderActionPolicyFinding[];
  verdict: ProviderActionVerdict;
}

export interface ProviderActionEvidencePackage {
  evidenceId: string;
  actionId: string;
  actionHash: string;
  request: ProviderActionRequest;
  gates: ProviderActionGateRecord[];
  advisory: ProviderActionAdvisory;
  policy: ProviderActionPolicyEvaluation;
  dryRunResult: {
    attempted: true;
    liveCallMade: false;
    simulatedOutcome: string;
  };
  verdict: ProviderActionVerdict;
  generatedAt: string;
}
