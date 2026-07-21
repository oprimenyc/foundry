import { listProviderActionEvidence, getProviderActionEvidence } from "./evidence";
import { listProviderActionGates, decideProviderActionGate } from "./gates";
import type { MutationRisk, ProviderActionGateRecord, ProviderActionVerdict } from "./types";

/**
 * Operator/query surface (Phase 5): what an operator needs to see for one
 * provider action plan or across all ingested plans, without ever exposing
 * a secret and without ever implying a live call happened. Mirrors
 * lib/secret-remediation/operator.ts.
 */
export interface ProviderActionOperatorSurfaceEntry {
  actionId: string;
  evidenceId: string;
  provider: string;
  actionType: string;
  project: string;
  environment: string;
  mutationRisk: MutationRisk;
  approvalState: ProviderActionGateRecord[];
  mutationState: "not_mutated";
  dryRunResult: string;
  blockedReason: string | null;
  verificationPlan: string[];
  rollbackPlan: string[];
  evidenceRefs: string[];
  remainingOwnerActions: string[];
  realProviderCallsMade: false;
  verdict: ProviderActionVerdict;
}

async function buildEntry(evidenceId: string): Promise<ProviderActionOperatorSurfaceEntry | undefined> {
  const evidence = await getProviderActionEvidence(evidenceId);
  if (!evidence) return undefined;
  // Gate status is queried live (not from the frozen evidence snapshot) so a decision
  // recorded after ingestion is reflected immediately, mirroring lib/secret-remediation/operator.ts.
  const liveGates = listProviderActionGates({ actionId: evidence.actionId });
  const blockingFinding = evidence.policy.findings.find((f) => f.severity === "block");
  const unresolvedGates = evidence.policy.requiredApprovalGates.filter((reason) => !liveGates.some((g) => g.reason === reason && g.status === "approved"));
  // Computed from live gate status, not the frozen evidence.policy.verdict: a gate decided
  // after ingestion must be reflected here immediately, same as approvalState above.
  const remainingOwnerActions =
    unresolvedGates.length > 0
      ? unresolvedGates.map((reason) => `Decide the "${reason}" approval gate, then have a human perform ${evidence.advisory.actionThatWouldBeTaken}`)
      : evidence.policy.requiredApprovalGates.length > 0
        ? [`Every required approval is granted — a human must still perform this action outside Foundry: ${evidence.advisory.actionThatWouldBeTaken}`]
        : [];

  return {
    actionId: evidence.actionId,
    evidenceId: evidence.evidenceId,
    provider: evidence.request.providerType,
    actionType: evidence.request.actionType,
    project: evidence.request.project,
    environment: evidence.request.targetEnvironment,
    mutationRisk: evidence.request.mutationRisk,
    approvalState: liveGates,
    mutationState: "not_mutated",
    dryRunResult: evidence.dryRunResult.simulatedOutcome,
    blockedReason: blockingFinding?.message ?? null,
    verificationPlan: evidence.request.verificationPlan,
    rollbackPlan: evidence.request.rollbackPlan,
    evidenceRefs: [evidence.evidenceId],
    remainingOwnerActions,
    realProviderCallsMade: false,
    verdict: evidence.policy.verdict,
  };
}

export async function getProviderActionStatus(actionIdOrEvidenceId: string): Promise<ProviderActionOperatorSurfaceEntry | undefined> {
  const all = await listProviderActionEvidence({});
  const match = all.find((e) => e.actionId === actionIdOrEvidenceId || e.evidenceId === actionIdOrEvidenceId);
  if (!match) return undefined;
  return buildEntry(match.evidenceId);
}

export interface ProviderActionOperatorReport {
  generatedAt: string;
  totalActions: number;
  byVerdict: Record<ProviderActionVerdict, number>;
  pendingApprovals: number;
  realProviderCallsMade: false;
  entries: ProviderActionOperatorSurfaceEntry[];
}

export async function getProviderActionOperatorReport(filter: { project?: string } = {}): Promise<ProviderActionOperatorReport> {
  const evidencePackages = await listProviderActionEvidence(filter);
  const entries = (await Promise.all(evidencePackages.map((e) => buildEntry(e.evidenceId)))).filter((e): e is ProviderActionOperatorSurfaceEntry => Boolean(e));

  const byVerdict: Record<ProviderActionVerdict, number> = { PASS: 0, FAIL: 0, BLOCKED: 0, PASS_WITH_WARNINGS: 0 };
  for (const entry of entries) byVerdict[entry.verdict] += 1;

  return {
    generatedAt: new Date().toISOString(),
    totalActions: entries.length,
    byVerdict,
    pendingApprovals: entries.reduce((sum, entry) => sum + entry.approvalState.filter((g) => g.status === "pending").length, 0),
    realProviderCallsMade: false,
    entries,
  };
}

export { decideProviderActionGate };
