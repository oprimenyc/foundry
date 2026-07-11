import { randomUUID } from "crypto";
import { recordAudit } from "./audit";
import { VaultAccessError, type ApprovalMode, type ApprovalRequest, type VaultAccessRequest } from "./types";

/**
 * Approval model: one-time, per-run, time-boxed, and standing approvals.
 * Standing approvals are only matchable for low/moderate risk — the policy
 * engine refuses to honor them for high/critical.
 */
const globalApprovals = globalThis as unknown as { __primeVaultApprovals?: Map<string, ApprovalRequest> };
if (!globalApprovals.__primeVaultApprovals) globalApprovals.__primeVaultApprovals = new Map();
const approvals = globalApprovals.__primeVaultApprovals;

export function requestApproval(request: VaultAccessRequest, mode: ApprovalMode = "require_manual_approval"): ApprovalRequest {
  const approval: ApprovalRequest = {
    approvalId: `apr_${randomUUID()}`,
    request,
    mode,
    status: "pending",
  };
  approvals.set(approval.approvalId, approval);
  recordAudit({
    actor: request.machineIdentity,
    action: "approval.request",
    resource: approval.approvalId,
    decision: "info",
    source: "approvals",
    correlationId: approval.approvalId,
    metadata: { runId: request.runId, action: request.intendedAction, risk: request.riskLevel },
  });
  return approval;
}

export function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected",
  decidedBy: string,
  options: { mode?: ApprovalMode; validUntil?: string; note?: string } = {}
): ApprovalRequest {
  const approval = approvals.get(approvalId);
  if (!approval) throw new VaultAccessError("Approval not found", ["unknown_approval"]);
  if (approval.status !== "pending") throw new VaultAccessError("Approval already decided", ["approval_already_decided"]);
  approval.status = decision;
  approval.decidedBy = decidedBy;
  approval.decidedAt = new Date().toISOString();
  if (options.mode) approval.mode = options.mode;
  if (options.validUntil) approval.validUntil = options.validUntil;
  if (options.note) approval.note = options.note;
  recordAudit({
    actor: decidedBy,
    action: `approval.${decision}`,
    resource: approvalId,
    decision: decision === "approved" ? "allow" : "deny",
    source: "approvals",
    correlationId: approvalId,
    metadata: { mode: approval.mode, runId: approval.request.runId },
  });
  return { ...approval };
}

export function getApproval(approvalId: string): ApprovalRequest | undefined {
  const approval = approvals.get(approvalId);
  return approval ? { ...approval } : undefined;
}

export function listApprovals(filter?: { status?: ApprovalRequest["status"]; organizationId?: string }): ApprovalRequest[] {
  return Array.from(approvals.values())
    .filter(
      (approval) =>
        (!filter?.status || approval.status === filter.status) &&
        (!filter?.organizationId || approval.request.organizationId === filter.organizationId)
    )
    .map((approval) => ({ ...approval }));
}

/**
 * Standing (recurring) approval match: same org/project/provider/capability/
 * action, approved with allow_recurring_policy or an unexpired allow_until.
 * Never matches across projects or environments.
 */
export function findStandingApproval(request: VaultAccessRequest): ApprovalRequest | undefined {
  const now = new Date().toISOString();
  for (const approval of Array.from(approvals.values())) {
    if (approval.status !== "approved") continue;
    if (approval.mode !== "allow_recurring_policy" && approval.mode !== "allow_until") continue;
    if (approval.mode === "allow_until" && (!approval.validUntil || approval.validUntil < now)) continue;
    const r = approval.request;
    if (
      r.organizationId === request.organizationId &&
      r.projectId === request.projectId &&
      r.environment === request.environment &&
      r.providerId === request.providerId &&
      r.capability === request.capability &&
      r.intendedAction === request.intendedAction
    ) {
      return { ...approval };
    }
  }
  return undefined;
}

export function resetApprovals(): void {
  approvals.clear();
}
