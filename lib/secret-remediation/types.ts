import { z } from "zod";
import { scanForRawSecretMaterial, isValidSecretFingerprint } from "./secret-scan";

/**
 * Foundry Secret Exposure Remediation Contract — provider-neutral.
 *
 * Same design rule as lib/email-qa/types.ts and docs/PROVIDER_INTERFACE.md:
 * nothing here names a vendor's live API. A finding describes *what was
 * exposed and where*; a plan describes *what must happen to remediate it*.
 * Only lib/secret-remediation/adapters/* are provider-classification-aware,
 * and even they never call a real API (see adapters/types.ts).
 *
 * Hard rule enforced by the schema itself: a finding can carry a secret's
 * *category* and an opaque *fingerprint* (sha256 hash), never its value. Any
 * string field containing raw-secret-shaped material fails validation.
 */

export const SECRET_CATEGORIES = [
  "github_pat",
  "database_url",
  "google_oauth_client_secret",
  "nextauth_secret",
  "generic_env_secret",
] as const;
export type SecretCategory = (typeof SECRET_CATEGORIES)[number];

export const PROVIDER_CLASSIFICATIONS = ["github", "database", "google", "nextauth", "generic"] as const;
export type ProviderClassification = (typeof PROVIDER_CLASSIFICATIONS)[number];

/** Maps each secret category to its provider classification. Fails closed on an unknown category. */
export const PROVIDER_CLASSIFICATION_BY_CATEGORY: Record<SecretCategory, ProviderClassification> = {
  github_pat: "github",
  database_url: "database",
  google_oauth_client_secret: "google",
  nextauth_secret: "nextauth",
  generic_env_secret: "generic",
};

export const EXPOSURE_LOCATIONS = [
  "current_tracked_file",
  "git_history",
  "local_git_config",
  "deployment_env",
  "unknown",
] as const;
export type ExposureLocation = (typeof EXPOSURE_LOCATIONS)[number];

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONTAINMENT_STATUSES = ["not_contained", "partially_contained", "contained", "unknown"] as const;
export type ContainmentStatus = (typeof CONTAINMENT_STATUSES)[number];

export const HISTORY_REWRITE_REQUIREMENTS = ["required", "optional", "not_applicable"] as const;
export type HistoryRewriteRequirement = (typeof HISTORY_REWRITE_REQUIREMENTS)[number];

export const REMEDIATION_VERDICTS = ["PASS", "FAIL", "BLOCKED", "PASS_WITH_WARNINGS"] as const;
export type RemediationVerdict = (typeof REMEDIATION_VERDICTS)[number];

/** The six approval-gate reasons Task 3 requires. Every one is a human-only action; Foundry only prepares. */
export const GATE_REASONS = [
  "live_provider_credential_rotation",
  "deployment_env_mutation",
  "credential_revocation",
  "git_history_rewrite",
  "force_push",
  "production_restart_redeploy",
] as const;
export type GateReason = (typeof GATE_REASONS)[number];

function rawSecretRefinement(value: unknown, ctx: z.RefinementCtx) {
  const matches = scanForRawSecretMaterial(value);
  for (const match of matches) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `raw secret-shaped material detected in "${match.field}" — only categories and sha256 fingerprints are accepted, never values`,
      path: match.field === "(root)" ? [] : match.field.split("."),
    });
  }
}

export const SecretExposureFindingInputSchema = z
  .object({
    /** Project/repo this finding belongs to (e.g. "panticandy", "vitalcore"). */
    project: z.string().min(1),
    /** File or path the secret was/is exposed in (e.g. ".env", ".git/config"). */
    filePath: z.string().min(1),
    /** Commit hash, config key, or other free-text source reference — never a secret value. */
    sourceReference: z.string().min(1),
    secretCategory: z.enum(SECRET_CATEGORIES),
    exposureLocation: z.enum(EXPOSURE_LOCATIONS),
    /** Opaque sha256 fingerprint of the exposed value, if computed out-of-band. Never the value itself. */
    secretFingerprint: z
      .string()
      .refine(isValidSecretFingerprint, { message: 'secretFingerprint must be a "sha256:<64 hex chars>" hash, never a raw value' })
      .optional(),
    severity: z.enum(SEVERITIES),
    containmentStatus: z.enum(CONTAINMENT_STATUSES),
    rotationRequired: z.boolean(),
    historyRewriteRequired: z.enum(HISTORY_REWRITE_REQUIREMENTS),
    deploymentEnvUpdateRequired: z.boolean(),
    /** Free-text context — secret-scanned like every other field. */
    notes: z.string().max(2000).optional(),
  })
  .superRefine(rawSecretRefinement);

export type SecretExposureFindingInput = z.infer<typeof SecretExposureFindingInputSchema>;

export interface SecretExposureFinding extends SecretExposureFindingInput {
  id: string;
  providerClassification: ProviderClassification;
  verdict: RemediationVerdict;
  createdAt: string;
}

export interface RemediationPlanGateRequirement {
  reason: GateReason;
  riskLevel: "high" | "critical";
  requiredAction: string;
}

export interface RemediationPlan {
  id: string;
  findingId: string;
  immediateContainmentSteps: string[];
  providerRotationSteps: string[];
  deploymentEnvUpdateSteps: string[];
  verificationSteps: string[];
  revocationSteps: string[];
  rollbackPlan: string[];
  humanApprovalGates: RemediationPlanGateRequirement[];
  evidenceRequirements: string[];
  remainingOwnerActions: string[];
  generatedAt: string;
}

export type GateStatus = "pending" | "approved" | "rejected" | "expired";

export interface RemediationGateRecord {
  id: string;
  findingId: string;
  planId: string;
  reason: GateReason;
  riskLevel: "high" | "critical";
  requiredAction: string;
  status: GateStatus;
  createdAt: string;
  expiresAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

/** One provider-classification-aware advisory. Always advisory: never mutates provider state. */
export interface RemediationAdvisory {
  adapterId: string;
  provider: ProviderClassification | "deployment-env" | "git-history";
  action: string;
  /** What *would* happen if a human executed this outside Foundry. Never executed by Foundry itself. */
  wouldAct: boolean;
  /** Always true: this adapter never performs the action itself. */
  blocked: true;
  requiredApproval: GateReason[];
  requiredCredentials: string[];
  verificationRequirement: string;
  evidenceRefs: string[];
  /** Always true: asserts (rather than merely claims) that no live call was made. */
  noRealMutationConfirmed: true;
}

export interface SecretRemediationEvidencePackage {
  evidenceId: string;
  findingId: string;
  findingHash: string;
  finding: SecretExposureFinding;
  plan: RemediationPlan;
  gates: RemediationGateRecord[];
  advisories: RemediationAdvisory[];
  verdict: RemediationVerdict;
  generatedAt: string;
}

export function classifyProvider(category: SecretCategory): ProviderClassification {
  return PROVIDER_CLASSIFICATION_BY_CATEGORY[category];
}

/**
 * Deterministic verdict rule: Foundry never rotates a real credential, so a
 * finding can reach PASS only when nothing further is owed. Anything left
 * outstanding (rotation, env update, or a still-open history-rewrite
 * decision) caps the verdict at PASS_WITH_WARNINGS at best — an honest
 * reflection of "contained, but the owner still has to act".
 */
export function computeRemediationVerdict(
  finding: Pick<SecretExposureFindingInput, "severity" | "containmentStatus" | "rotationRequired" | "deploymentEnvUpdateRequired" | "historyRewriteRequired">
): RemediationVerdict {
  if (finding.containmentStatus === "not_contained") {
    return finding.severity === "critical" || finding.severity === "high" ? "BLOCKED" : "FAIL";
  }
  if (finding.rotationRequired || finding.deploymentEnvUpdateRequired || finding.historyRewriteRequired === "required") {
    return "PASS_WITH_WARNINGS";
  }
  return "PASS";
}
