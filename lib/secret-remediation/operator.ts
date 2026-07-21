import { listRemediationEvidence, getRemediationEvidence } from "./evidence";
import { listRemediationGates, decideRemediationGate } from "./gates";
import type { GateReason, RemediationGateRecord, RemediationPlan, RemediationVerdict, Severity } from "./types";

/**
 * Operator/query surface (Task 6): what an operator needs to see for one
 * finding or across all ingested findings, without ever exposing a secret
 * value. Every "blocked" step is exactly what a live adapter *would* do —
 * "live" steps are always an empty array, asserting the invariant that
 * Foundry never actually executed a mutation.
 */
export interface RemediationOperatorSurfaceEntry {
  findingId: string;
  evidenceId: string;
  project: string;
  filePath: string;
  severity: Severity;
  providerClassification: string;
  containmentStatus: string;
  verdict: RemediationVerdict;
  requiredApprovals: GateReason[];
  gates: RemediationGateRecord[];
  remediationPlan: RemediationPlan;
  blockedSteps: string[];
  liveStepsExecuted: string[];
  evidenceRefs: string[];
  remainingOwnerActions: string[];
}

export interface RemediationOperatorReport {
  generatedAt: string;
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  pendingApprovals: number;
  entries: RemediationOperatorSurfaceEntry[];
}

async function buildEntry(evidenceId: string): Promise<RemediationOperatorSurfaceEntry | undefined> {
  const evidence = await getRemediationEvidence(evidenceId);
  if (!evidence) return undefined;
  // Gate status is queried live (not from the frozen evidence snapshot) so a
  // decision recorded after ingestion is reflected immediately.
  const liveGates = listRemediationGates({ findingId: evidence.findingId });
  return {
    findingId: evidence.findingId,
    evidenceId: evidence.evidenceId,
    project: evidence.finding.project,
    filePath: evidence.finding.filePath,
    severity: evidence.finding.severity,
    providerClassification: evidence.finding.providerClassification,
    containmentStatus: evidence.finding.containmentStatus,
    verdict: evidence.verdict,
    requiredApprovals: Array.from(new Set(liveGates.map((g) => g.reason))),
    gates: liveGates,
    remediationPlan: evidence.plan,
    blockedSteps: evidence.advisories.map((a) => `${a.provider}:${a.action}`),
    liveStepsExecuted: [],
    evidenceRefs: [evidence.evidenceId],
    remainingOwnerActions: evidence.plan.remainingOwnerActions,
  };
}

export async function getRemediationStatus(findingIdOrEvidenceId: string): Promise<RemediationOperatorSurfaceEntry | undefined> {
  const all = await listRemediationEvidence({});
  const match = all.find((e) => e.findingId === findingIdOrEvidenceId || e.evidenceId === findingIdOrEvidenceId);
  if (!match) return undefined;
  return buildEntry(match.evidenceId);
}

export async function getRemediationOperatorReport(filter: { project?: string } = {}): Promise<RemediationOperatorReport> {
  const evidencePackages = await listRemediationEvidence(filter);
  const entries = (await Promise.all(evidencePackages.map((e) => buildEntry(e.evidenceId)))).filter((e): e is RemediationOperatorSurfaceEntry => Boolean(e));

  const bySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const entry of entries) bySeverity[entry.severity] += 1;

  return {
    generatedAt: new Date().toISOString(),
    totalFindings: entries.length,
    bySeverity,
    pendingApprovals: entries.reduce((sum, entry) => sum + entry.gates.filter((g) => g.status === "pending").length, 0),
    entries,
  };
}

export { decideRemediationGate };
