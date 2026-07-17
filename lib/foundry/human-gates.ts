import { createApprovalGateRecord, getStoreSnapshot, insertRecord, updateRecords } from "./store";
import { classifyActionRisk } from "@/lib/vault/policy";
import type { ApprovalGateRecord, DeploymentPlanStepRecord } from "./types";

/**
 * Human gate pause/resume (Missions 2 & 6).
 *
 * Persisted human gates. When execution reaches a step that requires a human
 * (declared `approvalRequired`, or a high/critical-risk action), it raises a
 * durable ApprovalGateRecord, sets the run to `awaiting_approval`, and pauses
 * at that exact step. A human approves/rejects/defers; on approval the run
 * resumes from the same step. Because gates are persisted (not in-memory),
 * a pause survives a process restart.
 */

const DEFAULT_GATE_TTL_MS = 24 * 60 * 60_000; // 24h to decide before expiry

export interface GateRequirement {
  required: boolean;
  riskLevel: "low" | "moderate" | "high" | "critical";
  reason: string;
  requiredAction: string;
}

/**
 * Decide whether a step needs a human gate. `environment` raises mutating
 * actions to high risk in production. `approvalRequired` always forces a gate.
 */
export function evaluateGateRequirement(
  step: Pick<DeploymentPlanStepRecord, "action" | "approvalRequired">,
  environment: "development" | "staging" | "production" = "development"
): GateRequirement {
  const risk = classifyActionRisk(step.action, environment);
  const byRisk = risk === "high" || risk === "critical";
  const required = step.approvalRequired === true || byRisk;
  return {
    required,
    riskLevel: risk,
    reason: step.approvalRequired
      ? "step is explicitly marked approvalRequired"
      : byRisk
        ? `${risk}-risk action ${step.action} requires human approval`
        : "no human approval required",
    requiredAction: step.approvalRequired
      ? `Review and approve execution of ${step.action}`
      : `Confirm the ${risk}-risk ${step.action} operation is authorized`,
  };
}

export function findGate(snapshotGates: ApprovalGateRecord[], runId: string, planStepId: string): ApprovalGateRecord | undefined {
  // Most-recent gate for this run+step wins.
  return snapshotGates
    .filter((g) => g.runId === runId && g.planStepId === planStepId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export async function raiseGate(input: {
  runId: string;
  projectId: string;
  planStepId: string;
  provider: string;
  action: string;
  requirement: GateRequirement;
  now?: Date;
}): Promise<ApprovalGateRecord> {
  const now = input.now ?? new Date();
  const gate = createApprovalGateRecord({
    runId: input.runId,
    projectId: input.projectId,
    planStepId: input.planStepId,
    provider: input.provider,
    action: input.action,
    riskLevel: input.requirement.riskLevel,
    reason: input.requirement.reason,
    requiredAction: input.requirement.requiredAction,
    status: "pending",
    expiresAt: new Date(now.getTime() + DEFAULT_GATE_TTL_MS).toISOString(),
  });
  await insertRecord("approvalGates", gate);
  return gate;
}

export async function getGate(gateId: string): Promise<ApprovalGateRecord | undefined> {
  return (await getStoreSnapshot()).approvalGates.find((g) => g.id === gateId);
}

export async function listGates(filter: { runId?: string; projectId?: string; status?: ApprovalGateRecord["status"] } = {}): Promise<ApprovalGateRecord[]> {
  return (await getStoreSnapshot()).approvalGates.filter(
    (g) =>
      (!filter.runId || g.runId === filter.runId) &&
      (!filter.projectId || g.projectId === filter.projectId) &&
      (!filter.status || g.status === filter.status)
  );
}

export class GateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateError";
  }
}

/**
 * Record a human decision on a gate. Only pending gates can be decided; an
 * expired gate cannot be approved. Idempotent per gate: a decided gate is
 * immutable.
 */
export async function decideGate(
  gateId: string,
  decision: "approved" | "rejected" | "deferred",
  decidedBy: string,
  options: { note?: string; now?: Date } = {}
): Promise<ApprovalGateRecord> {
  const now = options.now ?? new Date();
  const snapshot = await getStoreSnapshot();
  const gate = snapshot.approvalGates.find((g) => g.id === gateId);
  if (!gate) throw new GateError(`gate ${gateId} not found`);
  if (gate.status !== "pending") throw new GateError(`gate ${gateId} already ${gate.status}`);
  if (gate.expiresAt < now.toISOString()) {
    await updateRecords("approvalGates", (g) => g.id === gateId, (g) => ({ ...g, status: "expired" }));
    throw new GateError(`gate ${gateId} expired at ${gate.expiresAt}`);
  }

  await updateRecords(
    "approvalGates",
    (g) => g.id === gateId,
    (g) => ({ ...g, status: decision, decidedBy, decidedAt: now.toISOString(), note: options.note })
  );
  const decided = (await getStoreSnapshot()).approvalGates.find((g) => g.id === gateId)!;
  return decided;
}
