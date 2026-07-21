import { readFile } from "fs/promises";
import { retainArtifact, listArtifacts } from "@/lib/foundry/artifacts";
import type { RetentionClass } from "@/lib/foundry/types";
import { ingestLocalExecutionEvidence, loadLocalExecutionEvidenceSource } from "./ingest";
import type { LocalExecutionIngestResult } from "./types";

/**
 * Ties ingest → policy → retain into the standardized result every
 * submission produces (Phase 1). Mirrors lib/secret-remediation/evidence.ts
 * and lib/email-qa/evidence.ts's shape: validate/normalize, derive, retain,
 * return. Both accepted evidence and rejections are retained — a rejection
 * is itself an audit-worthy event, never silently dropped.
 */

const EVIDENCE_ARTIFACT_KIND = "local_execution_evidence";
const REJECTION_ARTIFACT_KIND = "local_execution_ingest_rejection";

export interface RecordLocalExecutionEvidenceResult {
  result: LocalExecutionIngestResult;
  artifactId: string;
}

function retentionFor(result: LocalExecutionIngestResult): RetentionClass {
  if (result.status === "rejected") return "AUDIT";
  if (result.record.verdict === "BLOCKED" || result.record.verdict === "FAIL") return "AUDIT";
  return "STANDARD";
}

/** Ingest one raw evidence submission and retain the outcome (accepted or rejected) as a Foundry artifact. */
export async function recordLocalExecutionEvidence(rawInput: unknown, options: { source?: string } = {}): Promise<RecordLocalExecutionEvidenceResult> {
  const result = ingestLocalExecutionEvidence(rawInput);
  const artifact = await retainArtifact({
    kind: result.status === "accepted" ? EVIDENCE_ARTIFACT_KIND : REJECTION_ARTIFACT_KIND,
    content: result,
    contentType: "application/json",
    retentionClass: retentionFor(result),
    producer: "local-execution-evidence-adapter",
    source: options.source ?? "local-execution-ingest",
    projectId: result.status === "accepted" ? result.record.productTarget : undefined,
  });
  return { result, artifactId: artifact.id };
}

/** Ingest and retain every evidence submission found at a fixture file or artifact directory. */
export async function recordLocalExecutionEvidenceFromSource(sourcePath: string): Promise<RecordLocalExecutionEvidenceResult[]> {
  const submissions = await loadLocalExecutionEvidenceSource(sourcePath);
  const results: RecordLocalExecutionEvidenceResult[] = [];
  for (const submission of submissions) {
    results.push(await recordLocalExecutionEvidence(submission, { source: sourcePath }));
  }
  return results;
}

async function readArtifactContent(artifactId: string, kind: string): Promise<LocalExecutionIngestResult | undefined> {
  const artifacts = await listArtifacts({});
  const artifact = artifacts.find((a) => a.id === artifactId && a.kind === kind);
  if (!artifact) return undefined;
  const filePath = artifact.storageUri.replace(/^file:\/\//, "");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as LocalExecutionIngestResult;
}

export async function listLocalExecutionEvidence(filter: { productTarget?: string } = {}): Promise<LocalExecutionIngestResult[]> {
  const artifacts = (await listArtifacts({ projectId: filter.productTarget })).filter(
    (a) => a.kind === EVIDENCE_ARTIFACT_KIND || a.kind === REJECTION_ARTIFACT_KIND
  );
  const all = await Promise.all(artifacts.map((a) => readArtifactContent(a.id, a.kind)));
  return all.filter((r): r is LocalExecutionIngestResult => Boolean(r));
}

export async function getLocalExecutionEvidence(artifactId: string): Promise<LocalExecutionIngestResult | undefined> {
  return (await readArtifactContent(artifactId, EVIDENCE_ARTIFACT_KIND)) ?? (await readArtifactContent(artifactId, REJECTION_ARTIFACT_KIND));
}
