import { z } from "zod";
import { scanForRawSecretMaterial, isValidSecretFingerprint } from "@/lib/secret-remediation/secret-scan";

/**
 * Foundry Local Execution Evidence Contract — provider-neutral.
 *
 * Same design rule as lib/secret-remediation/types.ts and lib/email-qa/types.ts:
 * nothing here names a vendor's live API. A local-worker run (Ollama, a local
 * CLI agent, a PrimeOS-tier local runtime, ...) reports what it did; this
 * contract normalizes that report into an auditable evidence record and a
 * deterministic verdict. Foundry never executes the worker itself — this
 * module only ingests, evaluates, and preserves evidence of a run that
 * already happened locally.
 *
 * Hard rule enforced by the schema: raw secret material is never accepted
 * anywhere in the evidence (command strings, file paths, notes, ...) — an
 * evidence submission carrying secret-shaped material is rejected outright,
 * mirroring lib/secret-remediation/types.ts's superRefine.
 */

export const LOCAL_ADAPTER_TYPES = ["jcode", "wigolo", "ollama", "primeos_tier", "generic"] as const;
export type LocalAdapterType = (typeof LOCAL_ADAPTER_TYPES)[number];

export const COMMAND_CLASSES = [
  "read_only",
  "file_write_in_scope",
  "test_run",
  "build",
  "package_install",
  "provider_mutation",
  "auth_change",
  "billing_change",
  "security_change",
  "deploy_change",
  "database_change",
  "git_history_rewrite",
  "unknown",
] as const;
export type CommandClass = (typeof COMMAND_CLASSES)[number];

/** Command classes Foundry never accepts evidence of as an already-taken local action. */
export const FORBIDDEN_COMMAND_CLASSES: readonly CommandClass[] = ["git_history_rewrite"];

/** Domains treated as high-risk regardless of which command class touched them. */
export const HIGH_RISK_DOMAINS = ["auth_change", "billing_change", "security_change", "deploy_change", "database_change"] as const satisfies readonly CommandClass[];

export const CRITICALITIES = ["low", "standard", "high", "critical"] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const LOCAL_EXECUTION_VERDICTS = ["PASS", "FAIL", "BLOCKED", "PASS_WITH_WARNINGS"] as const;
export type LocalExecutionVerdict = (typeof LOCAL_EXECUTION_VERDICTS)[number];

export const ESCALATION_REASONS = [
  "provider_mutation_requires_approval",
  "high_risk_domain_touched",
  "forbidden_command_class",
  "out_of_scope_file_mutation",
  "missing_proof_at_criticality",
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export const CommandRecordSchema = z.object({
  command: z.string().min(1),
  commandClass: z.enum(COMMAND_CLASSES),
  exitCode: z.number().int(),
  wallClockMs: z.number().nonnegative(),
  retries: z.number().int().nonnegative().default(0),
});
export type CommandRecord = z.infer<typeof CommandRecordSchema>;

export const SecretScanResultSchema = z.object({
  ok: z.boolean(),
  matchedFields: z.array(z.string()).default([]),
});
export type SecretScanResult = z.infer<typeof SecretScanResultSchema>;

/** Reference to a gate that must exist before Foundry accepts a claimed provider mutation as evidence at all. */
export const ProviderMutationGateRefSchema = z.object({
  gateId: z.string().min(1),
  approved: z.boolean(),
});
export type ProviderMutationGateRef = z.infer<typeof ProviderMutationGateRefSchema>;

/** The raw local-worker evidence submission, as reported — before normalization or policy evaluation. */
export const LocalExecutionEvidenceInputSchema = z
  .object({
    missionId: z.string().min(1),
    productTarget: z.string().min(1),
    repoTarget: z.string().min(1).optional(),
    adapterType: z.enum(LOCAL_ADAPTER_TYPES),
    runtime: z.string().min(1).optional(),
    criticality: z.enum(CRITICALITIES).default("standard"),
    allowedFileScope: z.array(z.string().min(1)).min(1),
    filesTouched: z.array(z.string()).default([]),
    commandsRun: z.array(CommandRecordSchema).min(1),
    cacheRefs: z.array(z.string()).default([]),
    proofArtifacts: z.array(z.string()).default([]),
    providerMutationOccurred: z.boolean().default(false),
    providerMutationGate: ProviderMutationGateRefSchema.optional(),
    sourceMutationOccurred: z.boolean().default(false),
    /** Opaque sha256 fingerprint of any secret material the worker *observed* (never the value). */
    observedSecretFingerprint: z
      .string()
      .refine(isValidSecretFingerprint, { message: 'observedSecretFingerprint must be a "sha256:<64 hex chars>" hash, never a raw value' })
      .optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    for (const match of scanForRawSecretMaterial(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `raw secret-shaped material detected in "${match.field}" — Foundry never accepts evidence containing secret values`,
        path: match.field === "(root)" ? [] : match.field.split("."),
      });
    }
  });
export type LocalExecutionEvidenceInput = z.infer<typeof LocalExecutionEvidenceInputSchema>;

/** "block" → unreviewable, requires a human gate/escalation (BLOCKED). "blocking" → a proven policy violation (FAIL). "warning" → PASS_WITH_WARNINGS. */
export type PolicyFindingSeverity = "block" | "blocking" | "warning";

export interface PolicyFinding {
  code: string;
  message: string;
  severity: PolicyFindingSeverity;
}

export interface PolicyEvaluation {
  ok: boolean;
  findings: PolicyFinding[];
  requiredEscalations: EscalationReason[];
  frontierReviewRequired: boolean;
  verdict: LocalExecutionVerdict;
}

export interface LocalExecutionEvidenceRecord {
  evidenceId: string;
  missionId: string;
  productTarget: string;
  repoTarget?: string;
  adapterType: LocalAdapterType;
  runtime?: string;
  criticality: Criticality;
  commandsRun: CommandRecord[];
  exitCodes: number[];
  wallClockMs: number;
  retries: number;
  allowedFileScope: string[];
  filesTouched: string[];
  outOfScopeFiles: string[];
  cacheRefs: string[];
  proofArtifacts: string[];
  secretScanResult: SecretScanResult;
  providerMutationOccurred: boolean;
  sourceMutationOccurred: boolean;
  rawEvidenceHash: string;
  policy: PolicyEvaluation;
  verdict: LocalExecutionVerdict;
  /** A PASS-family local verdict is never final authority on its own; see docs/CURRENT_TRUTH — E.V.E. (or an equivalent independent verifier) must still verify. */
  requiresIndependentVerification: true;
  generatedAt: string;
}

export type IngestRejectionReason =
  | "malformed_evidence"
  | "missing_mission_id"
  | "missing_adapter_type"
  | "missing_command_log"
  | "secret_exposure_detected"
  | "unapproved_provider_mutation_claim";

export interface LocalExecutionIngestRejection {
  status: "rejected";
  reason: IngestRejectionReason;
  message: string;
  rawEvidenceHash: string;
}

export interface LocalExecutionIngestAccepted {
  status: "accepted";
  record: LocalExecutionEvidenceRecord;
}

export type LocalExecutionIngestResult = LocalExecutionIngestRejection | LocalExecutionIngestAccepted;
