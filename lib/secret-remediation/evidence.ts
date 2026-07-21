import { retainArtifact, listArtifacts } from "@/lib/foundry/artifacts";
import { sha256Canonical } from "@/lib/foundry/evidence-manifest";
import type { RetentionClass } from "@/lib/foundry/types";
import { newId } from "./ids";
import { assertNoRawSecretMaterial } from "./secret-scan";
import { generateRemediationPlan } from "./plan";
import { raiseGatesForPlan } from "./gates";
import { runApplicableAdapters } from "./adapters/registry";
import {
  SecretExposureFindingInputSchema,
  classifyProvider,
  computeRemediationVerdict,
  type SecretExposureFinding,
  type SecretExposureFindingInput,
  type SecretRemediationEvidencePackage,
} from "./types";

/**
 * Ties classify → plan → gate → advise into the standardized evidence
 * package every ingestion produces (Task 1/2/3/4/6). Mirrors
 * lib/email-qa/evidence.ts's shape: validate, derive, retain, return.
 */

const EVIDENCE_ARTIFACT_KIND = "secret_remediation_evidence";

export class SecretExposureFindingValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`secret exposure finding failed validation: ${issues.join("; ")}`);
    this.name = "SecretExposureFindingValidationError";
    this.issues = issues;
  }
}

/** Validates + rejects raw secret material. Never returns a finding built from bad input. */
export function parseSecretExposureFindingInput(input: unknown): SecretExposureFindingInput {
  const parsed = SecretExposureFindingInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new SecretExposureFindingValidationError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`));
  }
  return parsed.data;
}

function buildFinding(input: SecretExposureFindingInput): SecretExposureFinding {
  return {
    ...input,
    id: newId("secfind"),
    providerClassification: classifyProvider(input.secretCategory),
    verdict: computeRemediationVerdict(input),
    createdAt: new Date().toISOString(),
  };
}

export interface IngestSecretExposureFindingResult {
  evidence: SecretRemediationEvidencePackage;
}

/**
 * Full pipeline for one finding: validate → classify/verdict → plan →
 * raise approval gates → run advisory adapters → retain evidence artifact.
 * No provider is ever called; no secret value is ever accepted, stored, or
 * returned (enforced twice: schema-level in types.ts, and again here as
 * defense-in-depth immediately before persistence).
 */
export async function ingestSecretExposureFinding(rawInput: unknown): Promise<IngestSecretExposureFindingResult> {
  const input = parseSecretExposureFindingInput(rawInput);
  const finding = buildFinding(input);

  const plan = generateRemediationPlan(finding);
  const gates = raiseGatesForPlan(plan);
  const advisories = runApplicableAdapters(finding, plan);

  const evidenceContent: Omit<SecretRemediationEvidencePackage, "evidenceId"> = {
    findingId: finding.id,
    findingHash: sha256Canonical(finding),
    finding,
    plan,
    gates,
    advisories,
    verdict: finding.verdict,
    generatedAt: new Date().toISOString(),
  };

  // Defense-in-depth: retainArtifact also redacts known secret shapes before
  // writing, but this pipeline additionally refuses to persist at all if any
  // raw-secret-shaped material slipped through (it shouldn't — the schema
  // already rejected it — this asserts that invariant rather than trusting it).
  assertNoRawSecretMaterial(evidenceContent);

  const retentionClass: RetentionClass = finding.severity === "critical" || finding.severity === "high" ? "AUDIT" : "STANDARD";
  const artifact = await retainArtifact({
    kind: EVIDENCE_ARTIFACT_KIND,
    content: evidenceContent,
    contentType: "application/json",
    retentionClass,
    producer: "secret-remediation-orchestrator",
    source: finding.project,
    projectId: finding.project,
  });

  return { evidence: { ...evidenceContent, evidenceId: artifact.id } };
}

async function readEvidenceArtifact(artifactId: string): Promise<SecretRemediationEvidencePackage> {
  // Artifacts are content-addressed local files; lib/foundry/artifacts.ts owns the storage URI shape.
  const { readFile } = await import("fs/promises");
  const artifacts = await listArtifacts({});
  const artifact = artifacts.find((a) => a.id === artifactId && a.kind === EVIDENCE_ARTIFACT_KIND);
  if (!artifact) throw new Error(`secret remediation evidence artifact ${artifactId} not found`);
  const filePath = artifact.storageUri.replace(/^file:\/\//, "");
  const raw = await readFile(filePath, "utf8");
  const content = JSON.parse(raw) as Omit<SecretRemediationEvidencePackage, "evidenceId">;
  return { ...content, evidenceId: artifact.id };
}

export async function listRemediationEvidence(filter: { project?: string } = {}): Promise<SecretRemediationEvidencePackage[]> {
  const artifacts = (await listArtifacts({ projectId: filter.project })).filter((a) => a.kind === EVIDENCE_ARTIFACT_KIND);
  return Promise.all(artifacts.map((artifact) => readEvidenceArtifact(artifact.id)));
}

export async function getRemediationEvidence(evidenceId: string): Promise<SecretRemediationEvidencePackage | undefined> {
  try {
    return await readEvidenceArtifact(evidenceId);
  } catch {
    return undefined;
  }
}
