import { retainArtifact, listArtifacts } from "@/lib/foundry/artifacts";
import { sha256Canonical } from "@/lib/foundry/evidence-manifest";
import type { RetentionClass } from "@/lib/foundry/types";
import { newId } from "./ids";
import { assertNoRawSecretMaterial } from "@/lib/secret-remediation/secret-scan";
import { raiseGatesForRequest } from "./gates";
import { resolveProviderActionAdapter } from "./adapters/registry";
import { computeMutationRisk, evaluateProviderActionPolicy, requiredApprovalGateReasons } from "./policy";
import {
  ProviderActionRequestInputSchema,
  type ProviderActionEvidencePackage,
  type ProviderActionRequest,
  type ProviderActionRequestInput,
} from "./types";

/**
 * Ties validate -> classify(mutation risk) -> resolve adapter -> raise gates
 * -> advise -> policy -> retain into the standardized evidence package every
 * ingestion produces (Phase 1/2/3/5/6). Mirrors
 * lib/secret-remediation/evidence.ts's shape exactly: validate, derive,
 * retain, return. No live provider call happens anywhere in this pipeline —
 * `advise()` is pure and synchronous, `evaluateProviderActionPolicy` is pure,
 * and this orchestrator itself makes no network call either.
 */

const EVIDENCE_ARTIFACT_KIND = "provider_action_evidence";

export class ProviderActionRequestValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`provider action request failed validation: ${issues.join("; ")}`);
    this.name = "ProviderActionRequestValidationError";
    this.issues = issues;
  }
}

export class UnsupportedProviderActionError extends Error {
  constructor(providerType: string, actionType: string) {
    super(`no adapter registered for providerType=${providerType} actionType=${actionType}`);
    this.name = "UnsupportedProviderActionError";
  }
}

/** Validates + rejects raw secret material. Never returns a request built from bad input. */
export function parseProviderActionRequestInput(input: unknown): ProviderActionRequestInput {
  const parsed = ProviderActionRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProviderActionRequestValidationError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`));
  }
  return parsed.data;
}

function buildRequest(input: ProviderActionRequestInput): ProviderActionRequest {
  return {
    ...input,
    id: newId("provact"),
    mutationRisk: computeMutationRisk(input),
    createdAt: new Date().toISOString(),
  };
}

export interface IngestProviderActionResult {
  evidence: ProviderActionEvidencePackage;
}

/**
 * Full pipeline for one provider action request. Throws
 * ProviderActionRequestValidationError for malformed/secret-carrying input,
 * and UnsupportedProviderActionError for a (providerType, actionType) pair
 * with no adapter — both are structural failures the caller must fix, never
 * silently downgraded to a "BLOCKED" evidence record.
 */
export async function ingestProviderActionRequest(rawInput: unknown): Promise<IngestProviderActionResult> {
  const input = parseProviderActionRequestInput(rawInput);
  const request = buildRequest(input);

  const adapter = resolveProviderActionAdapter(request.providerType, request.actionType);
  if (!adapter) throw new UnsupportedProviderActionError(request.providerType, request.actionType);

  const required = requiredApprovalGateReasons(request);
  const gates = raiseGatesForRequest(request, required);
  const advisory = adapter.advise(request, required);
  const policy = evaluateProviderActionPolicy(request, gates, advisory);

  const evidenceContent: Omit<ProviderActionEvidencePackage, "evidenceId"> = {
    actionId: request.id,
    actionHash: sha256Canonical(request),
    request,
    gates,
    advisory,
    policy,
    dryRunResult: { attempted: true, liveCallMade: false, simulatedOutcome: advisory.actionThatWouldBeTaken },
    verdict: policy.verdict,
    generatedAt: new Date().toISOString(),
  };

  // Defense-in-depth: retainArtifact also redacts known secret shapes before
  // writing, but this pipeline additionally refuses to persist at all if any
  // raw-secret-shaped material slipped through (it shouldn't — the schema
  // already rejected it — this asserts that invariant rather than trusting it).
  assertNoRawSecretMaterial(evidenceContent);

  const retentionClass: RetentionClass = request.mutationRisk === "critical" || request.mutationRisk === "high" ? "AUDIT" : "STANDARD";
  const artifact = await retainArtifact({
    kind: EVIDENCE_ARTIFACT_KIND,
    content: evidenceContent,
    contentType: "application/json",
    retentionClass,
    producer: "provider-action-adapter",
    source: request.project,
    projectId: request.project,
  });

  return { evidence: { ...evidenceContent, evidenceId: artifact.id } };
}

async function readEvidenceArtifact(artifactId: string): Promise<ProviderActionEvidencePackage> {
  const { readFile } = await import("fs/promises");
  const artifacts = await listArtifacts({});
  const artifact = artifacts.find((a) => a.id === artifactId && a.kind === EVIDENCE_ARTIFACT_KIND);
  if (!artifact) throw new Error(`provider action evidence artifact ${artifactId} not found`);
  const filePath = artifact.storageUri.replace(/^file:\/\//, "");
  const raw = await readFile(filePath, "utf8");
  const content = JSON.parse(raw) as Omit<ProviderActionEvidencePackage, "evidenceId">;
  return { ...content, evidenceId: artifact.id };
}

export async function listProviderActionEvidence(filter: { project?: string } = {}): Promise<ProviderActionEvidencePackage[]> {
  const artifacts = (await listArtifacts({ projectId: filter.project })).filter((a) => a.kind === EVIDENCE_ARTIFACT_KIND);
  return Promise.all(artifacts.map((artifact) => readEvidenceArtifact(artifact.id)));
}

export async function getProviderActionEvidence(evidenceId: string): Promise<ProviderActionEvidencePackage | undefined> {
  try {
    return await readEvidenceArtifact(evidenceId);
  } catch {
    return undefined;
  }
}
