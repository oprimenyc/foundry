import { listLocalExecutionEvidence } from "./evidence";
import type { EscalationReason, LocalExecutionVerdict } from "./types";

/**
 * Operator/query surface (Phase 1): what an operator needs to see for one
 * local-worker run or across all ingested submissions, without re-deriving
 * anything from raw evidence. Mirrors lib/secret-remediation/operator.ts.
 */
export interface LocalExecutionOperatorSurfaceEntry {
  status: "accepted" | "rejected";
  adapter: string;
  targetProduct: string | null;
  targetRepo: string | null;
  missionId: string | null;
  localVerdict: LocalExecutionVerdict | null;
  policyVerdict: LocalExecutionVerdict | null;
  requiredEscalations: EscalationReason[];
  frontierReviewRequired: boolean;
  requiresIndependentVerification: boolean;
  evidenceRefs: string[];
  commandSummary: string;
  touchedFilesSummary: string;
  rejectionReason: string | null;
}

function buildEntry(evidenceLike: Awaited<ReturnType<typeof listLocalExecutionEvidence>>[number], artifactId: string): LocalExecutionOperatorSurfaceEntry {
  if (evidenceLike.status === "rejected") {
    return {
      status: "rejected",
      adapter: "unknown",
      targetProduct: null,
      targetRepo: null,
      missionId: null,
      localVerdict: null,
      policyVerdict: null,
      requiredEscalations: [],
      frontierReviewRequired: false,
      requiresIndependentVerification: false,
      evidenceRefs: [artifactId],
      commandSummary: "n/a — evidence rejected before policy evaluation",
      touchedFilesSummary: "n/a — evidence rejected before policy evaluation",
      rejectionReason: `${evidenceLike.reason}: ${evidenceLike.message}`,
    };
  }
  const record = evidenceLike.record;
  const exitCodeSummary = record.exitCodes.length > 0 ? `${record.exitCodes.filter((c) => c === 0).length}/${record.exitCodes.length} exited 0` : "no commands";
  return {
    status: "accepted",
    adapter: record.adapterType,
    targetProduct: record.productTarget,
    targetRepo: record.repoTarget ?? null,
    missionId: record.missionId,
    localVerdict: record.verdict,
    policyVerdict: record.policy.verdict,
    requiredEscalations: record.policy.requiredEscalations,
    frontierReviewRequired: record.policy.frontierReviewRequired,
    requiresIndependentVerification: record.requiresIndependentVerification,
    evidenceRefs: [record.evidenceId],
    commandSummary: `${record.commandsRun.length} command(s), ${exitCodeSummary}, ${record.wallClockMs}ms wall-clock, ${record.retries} retr(y/ies)`,
    touchedFilesSummary:
      record.filesTouched.length === 0
        ? "no files touched"
        : `${record.filesTouched.length} file(s) touched${record.outOfScopeFiles.length > 0 ? `, ${record.outOfScopeFiles.length} out of scope` : ""}`,
    rejectionReason: null,
  };
}

export interface LocalExecutionOperatorReport {
  generatedAt: string;
  totalSubmissions: number;
  accepted: number;
  rejected: number;
  byVerdict: Record<LocalExecutionVerdict, number>;
  pendingEscalations: number;
  entries: LocalExecutionOperatorSurfaceEntry[];
}

export async function getLocalExecutionOperatorReport(filter: { productTarget?: string } = {}): Promise<LocalExecutionOperatorReport> {
  const all = await listLocalExecutionEvidence(filter);
  // listLocalExecutionEvidence doesn't currently expose the artifact id alongside content,
  // so entries built here reference the evidenceId/rawEvidenceHash already carried on each result.
  const entries = all.map((r) => buildEntry(r, r.status === "accepted" ? r.record.evidenceId : r.rawEvidenceHash));

  const byVerdict: Record<LocalExecutionVerdict, number> = { PASS: 0, FAIL: 0, BLOCKED: 0, PASS_WITH_WARNINGS: 0 };
  for (const entry of entries) {
    if (entry.localVerdict) byVerdict[entry.localVerdict] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalSubmissions: entries.length,
    accepted: entries.filter((e) => e.status === "accepted").length,
    rejected: entries.filter((e) => e.status === "rejected").length,
    byVerdict,
    pendingEscalations: entries.filter((e) => e.requiredEscalations.length > 0).length,
    entries,
  };
}
