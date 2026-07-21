import { newId } from "./ids";
import type { ProviderActionGateRecord, ProviderActionGateReason, ProviderActionRequest } from "./types";

/**
 * Approval gates (Phase 3/5). One record per required gate reason, raised
 * automatically for every ingested request. A reason the submitter listed in
 * `preApprovedGateReasons` is raised already-approved (decidedBy set to a
 * fixed marker) rather than pending — still a persisted, auditable record,
 * never silently skipped. Modeled after lib/secret-remediation/gates.ts,
 * simplified: no TTL/expiry — this module's gates track a *future* action
 * that has not yet happened, not a time-boxed live-run pause.
 */

const PRE_APPROVED_MARKER = "pre-approved-at-submission";

const globalForGates = globalThis as unknown as { __foundryProviderActionGates?: ProviderActionGateRecord[] };
if (!globalForGates.__foundryProviderActionGates) globalForGates.__foundryProviderActionGates = [];
const gateStore = globalForGates.__foundryProviderActionGates;

/** Test-only: clears all gate state. Production code never calls this. */
export function resetProviderActionGates(): void {
  gateStore.length = 0;
}

export function raiseGatesForRequest(request: ProviderActionRequest, requiredReasons: ProviderActionGateReason[], now: Date = new Date()): ProviderActionGateRecord[] {
  const created = requiredReasons.map((reason) => {
    const preApproved = request.preApprovedGateReasons.includes(reason);
    const gate: ProviderActionGateRecord = {
      id: newId("provactgate"),
      actionId: request.id,
      reason,
      status: preApproved ? "approved" : "pending",
      createdAt: now.toISOString(),
      ...(preApproved ? { decidedBy: PRE_APPROVED_MARKER, decidedAt: now.toISOString() } : {}),
    };
    gateStore.push(gate);
    return gate;
  });
  return created;
}

export function listProviderActionGates(filter: { actionId?: string; status?: ProviderActionGateRecord["status"] } = {}): ProviderActionGateRecord[] {
  return gateStore.filter((gate) => (!filter.actionId || gate.actionId === filter.actionId) && (!filter.status || gate.status === filter.status));
}

export function getProviderActionGate(gateId: string): ProviderActionGateRecord | undefined {
  return gateStore.find((gate) => gate.id === gateId);
}

export class ProviderActionGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderActionGateError";
  }
}

/** Record a human decision on a gate. Only a pending gate can be decided; a decided gate is immutable. */
export function decideProviderActionGate(gateId: string, decision: "approved" | "rejected", decidedBy: string, options: { note?: string; now?: Date } = {}): ProviderActionGateRecord {
  const now = options.now ?? new Date();
  const index = gateStore.findIndex((gate) => gate.id === gateId);
  if (index === -1) throw new ProviderActionGateError(`gate ${gateId} not found`);
  const gate = gateStore[index];
  if (gate.status !== "pending") throw new ProviderActionGateError(`gate ${gateId} already ${gate.status}`);
  const decided: ProviderActionGateRecord = { ...gate, status: decision, decidedBy, decidedAt: now.toISOString(), note: options.note };
  gateStore[index] = decided;
  return decided;
}
