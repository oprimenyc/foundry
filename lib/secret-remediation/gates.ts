import { newId } from "./ids";
import type { GateReason, RemediationGateRecord, RemediationPlan } from "./types";

/**
 * Approval gates (Task 3). Foundry may prepare a remediation plan and even
 * describe exactly what a live rotation/mutation/rewrite would do, but it
 * never performs a high/critical-risk action without an explicit, persisted
 * human decision recorded here first. Modeled after lib/foundry/human-gates.ts
 * (pending/approved/rejected/expired, TTL, decide-once immutability) but
 * scoped to remediation plans instead of deployment-run steps, since this
 * feature has no execution engine to pause/resume.
 */

const DEFAULT_GATE_TTL_MS = 72 * 60 * 60_000; // 72h — cross-team credential rotation coordination needs more than a day

const globalForGates = globalThis as unknown as { __foundrySecretRemediationGates?: RemediationGateRecord[] };
if (!globalForGates.__foundrySecretRemediationGates) globalForGates.__foundrySecretRemediationGates = [];
const gateStore = globalForGates.__foundrySecretRemediationGates;

/** Test-only: clears all gate state. Production code never calls this. */
export function resetRemediationGates(): void {
  gateStore.length = 0;
}

export function raiseGatesForPlan(plan: RemediationPlan, now: Date = new Date()): RemediationGateRecord[] {
  const expiresAt = new Date(now.getTime() + DEFAULT_GATE_TTL_MS).toISOString();
  const created = plan.humanApprovalGates.map((requirement) => {
    const gate: RemediationGateRecord = {
      id: newId("remgate"),
      findingId: plan.findingId,
      planId: plan.id,
      reason: requirement.reason,
      riskLevel: requirement.riskLevel,
      requiredAction: requirement.requiredAction,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt,
    };
    gateStore.push(gate);
    return gate;
  });
  return created;
}

export function listRemediationGates(filter: { findingId?: string; planId?: string; status?: RemediationGateRecord["status"] } = {}): RemediationGateRecord[] {
  return gateStore.filter(
    (gate) =>
      (!filter.findingId || gate.findingId === filter.findingId) &&
      (!filter.planId || gate.planId === filter.planId) &&
      (!filter.status || gate.status === filter.status)
  );
}

export function getRemediationGate(gateId: string): RemediationGateRecord | undefined {
  return gateStore.find((gate) => gate.id === gateId);
}

export class RemediationGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemediationGateError";
  }
}

/** Record a human decision on a gate. Only pending, unexpired gates can be decided; a decided gate is immutable. */
export function decideRemediationGate(
  gateId: string,
  decision: "approved" | "rejected",
  decidedBy: string,
  options: { note?: string; now?: Date } = {}
): RemediationGateRecord {
  const now = options.now ?? new Date();
  const index = gateStore.findIndex((gate) => gate.id === gateId);
  if (index === -1) throw new RemediationGateError(`gate ${gateId} not found`);
  const gate = gateStore[index];
  if (gate.status !== "pending") throw new RemediationGateError(`gate ${gateId} already ${gate.status}`);
  if (gate.expiresAt < now.toISOString()) {
    gateStore[index] = { ...gate, status: "expired" };
    throw new RemediationGateError(`gate ${gateId} expired at ${gate.expiresAt}`);
  }
  const decided: RemediationGateRecord = { ...gate, status: decision, decidedBy, decidedAt: now.toISOString(), note: options.note };
  gateStore[index] = decided;
  return decided;
}

export function requiredGateReasons(plan: RemediationPlan): GateReason[] {
  return Array.from(new Set(plan.humanApprovalGates.map((g) => g.reason)));
}
