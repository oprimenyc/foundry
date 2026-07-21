import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { sha256Canonical } from "@/lib/foundry/evidence-manifest";
import { scanForRawSecretMaterial } from "@/lib/secret-remediation/secret-scan";
import { newId } from "./ids";
import { evaluateLocalExecutionPolicy, findOutOfScopeFiles } from "./policy";
import { LocalExecutionEvidenceInputSchema, type LocalExecutionEvidenceRecord, type LocalExecutionIngestResult, type IngestRejectionReason } from "./types";

/**
 * Ingest/normalize a local-worker execution evidence submission (Phase 1).
 *
 * Two tiers, mirroring lib/secret-remediation's classify/verdict split:
 *  - structural rejection (this function, before policy ever runs): evidence
 *    that is malformed, missing an identifying field, missing its command
 *    log, carrying raw secret material, or claiming a provider mutation with
 *    no gate reference at all is refused outright — Foundry never accepts it
 *    as reviewable evidence in the first place, though a rejection record
 *    (hash-only, never raw content) is always returned so the rejection
 *    itself is auditable.
 *  - policy evaluation (./policy.ts): well-formed evidence always produces a
 *    complete record with a verdict, even when that verdict is BLOCKED (e.g.
 *    a provider-mutation claim referencing a gate that exists but isn't yet
 *    approved) — that evidence is trustworthy enough to review, just not yet
 *    approved to proceed on.
 */

function reject(reason: IngestRejectionReason, message: string, rawEvidenceHash: string): LocalExecutionIngestResult {
  return { status: "rejected", reason, message, rawEvidenceHash };
}

export function ingestLocalExecutionEvidence(rawInput: unknown): LocalExecutionIngestResult {
  const rawEvidenceHash = sha256Canonical(rawInput);

  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    return reject("malformed_evidence", "evidence submission is not a JSON object", rawEvidenceHash);
  }
  const obj = rawInput as Record<string, unknown>;

  if (typeof obj.missionId !== "string" || obj.missionId.length === 0) {
    return reject("missing_mission_id", "evidence submission has no missionId", rawEvidenceHash);
  }
  if (typeof obj.adapterType !== "string" || obj.adapterType.length === 0) {
    return reject("missing_adapter_type", "evidence submission has no adapterType", rawEvidenceHash);
  }
  if (!Array.isArray(obj.commandsRun) || obj.commandsRun.length === 0) {
    return reject("missing_command_log", "evidence submission has no commandsRun log", rawEvidenceHash);
  }

  // Never accept evidence containing secret-shaped material anywhere — the rejection record
  // below preserves only field names and a hash, never the matched text or the raw payload.
  const secretMatches = scanForRawSecretMaterial(rawInput);
  if (secretMatches.length > 0) {
    return reject(
      "secret_exposure_detected",
      `secret-shaped material detected in field(s): ${secretMatches.map((m) => m.field).join(", ")}`,
      rawEvidenceHash
    );
  }

  // A provider-mutation claim with literally no gate reference is structurally incomplete —
  // distinct from (and stricter than) a claim that references a gate still pending approval,
  // which is accepted and evaluated by policy below as BLOCKED.
  if (obj.providerMutationOccurred === true && (obj.providerMutationGate === undefined || obj.providerMutationGate === null)) {
    return reject(
      "unapproved_provider_mutation_claim",
      "evidence claims a provider mutation occurred with no approval gate referenced at all",
      rawEvidenceHash
    );
  }

  const parsed = LocalExecutionEvidenceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return reject(
      "malformed_evidence",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "),
      rawEvidenceHash
    );
  }
  const input = parsed.data;

  const outOfScopeFiles = findOutOfScopeFiles(input.filesTouched, input.allowedFileScope);
  const policy = evaluateLocalExecutionPolicy({
    criticality: input.criticality,
    commandsRun: input.commandsRun,
    filesTouched: input.filesTouched,
    allowedFileScope: input.allowedFileScope,
    proofArtifacts: input.proofArtifacts,
    providerMutationOccurred: input.providerMutationOccurred,
    providerMutationGate: input.providerMutationGate,
    sourceMutationOccurred: input.sourceMutationOccurred,
    secretScanOk: true, // ingest already rejected any submission that failed this above
  });

  const record: LocalExecutionEvidenceRecord = {
    evidenceId: newId("localexec"),
    missionId: input.missionId,
    productTarget: input.productTarget,
    repoTarget: input.repoTarget,
    adapterType: input.adapterType,
    runtime: input.runtime,
    criticality: input.criticality,
    commandsRun: input.commandsRun,
    exitCodes: input.commandsRun.map((c) => c.exitCode),
    wallClockMs: input.commandsRun.reduce((sum, c) => sum + c.wallClockMs, 0),
    retries: input.commandsRun.reduce((sum, c) => sum + c.retries, 0),
    allowedFileScope: input.allowedFileScope,
    filesTouched: input.filesTouched,
    outOfScopeFiles,
    cacheRefs: input.cacheRefs,
    proofArtifacts: input.proofArtifacts,
    secretScanResult: { ok: true, matchedFields: [] },
    providerMutationOccurred: input.providerMutationOccurred,
    sourceMutationOccurred: input.sourceMutationOccurred,
    rawEvidenceHash,
    policy,
    verdict: policy.verdict,
    requiresIndependentVerification: true,
    generatedAt: new Date().toISOString(),
  };

  return { status: "accepted", record };
}

/** Reads and JSON-parses one evidence fixture file. Never returns silently on a bad file. */
export async function loadLocalExecutionEvidenceFile(filePath: string): Promise<unknown> {
  if (!existsSync(filePath)) {
    throw new Error(`[local-execution] evidence file not found: ${filePath}`);
  }
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`[local-execution] ${filePath} is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * Loads local-execution evidence either from a single fixture JSON file, or
 * (when given a directory) from every `*.evidence.json` file inside it — the
 * shape an artifact directory produced by a local worker run is expected to
 * take. Throws — never silently returns empty — when nothing is found.
 */
export async function loadLocalExecutionEvidenceSource(sourcePath: string): Promise<unknown[]> {
  if (!existsSync(sourcePath)) {
    throw new Error(`[local-execution] evidence source not found: ${sourcePath}`);
  }
  const { statSync, readdirSync } = await import("fs");
  const stat = statSync(sourcePath);
  if (stat.isFile()) {
    return [await loadLocalExecutionEvidenceFile(sourcePath)];
  }
  const files = readdirSync(sourcePath).filter((f) => f.endsWith(".evidence.json"));
  if (files.length === 0) {
    throw new Error(`[local-execution] no *.evidence.json files found in artifact directory ${sourcePath}`);
  }
  return Promise.all(files.map((f) => loadLocalExecutionEvidenceFile(path.join(sourcePath, f))));
}
