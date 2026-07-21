import {
  NON_MUTATING_ACTION_TYPES,
  PERMANENTLY_ADVISORY_ACTION_TYPES,
  type MutationRisk,
  type ProviderActionAdvisory,
  type ProviderActionGateReason,
  type ProviderActionGateRecord,
  type ProviderActionPolicyEvaluation,
  type ProviderActionPolicyFinding,
  type ProviderActionRequest,
  type ProviderActionVerdict,
} from "./types";

/**
 * Approval policy engine (Phase 3). Pure functions: given a normalized
 * request, decide which human approval gates it requires, and — given the
 * gate records already raised for it plus the adapter's own advisory —
 * decide the final verdict. Never mutates a gate; never executes anything.
 *
 * Verdict rule, mirroring lib/secret-remediation/types.ts's
 * computeRemediationVerdict ("Foundry never rotates a real credential, so a
 * finding can reach PASS only when nothing further is owed"):
 *  - a missing local prerequisite (e.g. a CLI not installed) always BLOCKS,
 *    regardless of approval state — there is nothing to approve yet;
 *  - a mutating action (revoke/rotate/env-update/restart/redeploy) is
 *    BLOCKED while any required gate is pending or rejected, and capped at
 *    PASS_WITH_WARNINGS even once every required gate is approved — Foundry
 *    still never performs the live action itself, so something is always
 *    still owed to the human who does;
 *  - a non-mutating action (verify_service_health) can reach a plain PASS —
 *    the advisory itself is the entire deliverable, nothing is owed;
 *  - a permanently-advisory action type (git_history_rewrite_advisory,
 *    dns_advisory) is always PASS_WITH_WARNINGS — well-formed and complete,
 *    but by design there is no live executor for it anywhere in this module.
 */

const PRODUCTION_TIER_ACTION_TYPES = ["revoke_credential", "rotate_credential", "update_deployment_env_var", "restart_service", "redeploy_service"] as const;

export function requiredApprovalGateReasons(request: Pick<ProviderActionRequest, "actionType" | "providerType" | "targetEnvironment" | "forcePushRequired">): ProviderActionGateReason[] {
  const gates = new Set<ProviderActionGateReason>();

  switch (request.actionType) {
    case "revoke_credential":
      gates.add("live_provider_mutation");
      gates.add("credential_revocation");
      break;
    case "rotate_credential":
      gates.add("live_provider_mutation");
      gates.add("credential_rotation");
      break;
    case "update_deployment_env_var":
      gates.add("live_provider_mutation");
      gates.add("deployment_env_mutation");
      break;
    case "restart_service":
    case "redeploy_service":
      gates.add("live_provider_mutation");
      gates.add("restart_redeploy");
      break;
    case "verify_service_health":
      break;
    case "git_history_rewrite_advisory":
      gates.add("git_history_rewrite");
      if (request.forcePushRequired) gates.add("force_push");
      break;
    case "dns_advisory":
      gates.add("dns_mutation");
      break;
  }

  // NextAuth secret regeneration invalidates every live session — rotating the value alone is
  // not enough, the running deployment must also be updated, mirroring lib/secret-remediation
  // /plan.ts's identical special case for nextauth_secret.
  if (request.providerType === "nextauth" && gates.has("credential_rotation")) {
    gates.add("deployment_env_mutation");
  }

  // Production is a stronger approval tier than staging/development for every mutating action type.
  if (request.targetEnvironment === "production" && (PRODUCTION_TIER_ACTION_TYPES as readonly string[]).includes(request.actionType)) {
    gates.add("production_target");
  }

  return Array.from(gates);
}

export function computeMutationRisk(request: Pick<ProviderActionRequest, "actionType" | "targetEnvironment">): MutationRisk {
  if (request.actionType === "verify_service_health") return "none";
  if (request.actionType === "dns_advisory") return "medium";
  if (request.actionType === "git_history_rewrite_advisory") return "critical";
  // Remaining action types are all live-mutation-shaped.
  if (request.targetEnvironment === "production") {
    return request.actionType === "revoke_credential" || request.actionType === "rotate_credential" ? "critical" : "high";
  }
  return request.targetEnvironment === "staging" ? "medium" : "low";
}

function gateStatusFor(reason: ProviderActionGateReason, gates: ProviderActionGateRecord[]): "pending" | "approved" | "rejected" | "missing" {
  const gate = gates.find((g) => g.reason === reason);
  return gate ? gate.status : "missing";
}

export function evaluateProviderActionPolicy(
  request: ProviderActionRequest,
  gates: ProviderActionGateRecord[],
  advisory: ProviderActionAdvisory
): ProviderActionPolicyEvaluation {
  const requiredApprovalGates = requiredApprovalGateReasons(request);
  const findings: ProviderActionPolicyFinding[] = [];

  if (!advisory.prerequisiteMet) {
    findings.push({
      code: "PROVIDER_PREREQUISITE_MISSING",
      severity: "block",
      message: advisory.blockedReason ?? `a required local prerequisite for ${request.providerType}:${request.actionType} is not met`,
    });
    return { requiredApprovalGates, findings, verdict: "BLOCKED" };
  }

  if ((NON_MUTATING_ACTION_TYPES as readonly string[]).includes(request.actionType)) {
    return { requiredApprovalGates, findings, verdict: "PASS" };
  }

  if ((PERMANENTLY_ADVISORY_ACTION_TYPES as readonly string[]).includes(request.actionType)) {
    findings.push({
      code: "PERMANENTLY_ADVISORY_ACTION",
      severity: "warning",
      message: `${request.actionType} has no live executor in this module by design — this plan is advisory-only until a human acts on it outside Foundry`,
    });
    return { requiredApprovalGates, findings, verdict: "PASS_WITH_WARNINGS" };
  }

  const unresolved = requiredApprovalGates.filter((reason) => gateStatusFor(reason, gates) !== "approved");
  if (unresolved.length > 0) {
    const rejected = unresolved.filter((reason) => gateStatusFor(reason, gates) === "rejected");
    findings.push({
      code: rejected.length > 0 ? "REQUIRED_APPROVAL_REJECTED" : "REQUIRED_APPROVAL_PENDING",
      severity: "block",
      message: `${unresolved.length} of ${requiredApprovalGates.length} required approval gate(s) not yet approved: ${unresolved.join(", ")}`,
    });
    return { requiredApprovalGates, findings, verdict: "BLOCKED" };
  }

  // Every required gate is approved. Still capped below a plain PASS — see module doc comment.
  findings.push({
    code: "MUTATION_APPROVED_NOT_EXECUTED",
    severity: "warning",
    message: "every required approval gate is approved, but Foundry never performs the live action itself — a human must still execute it outside this system",
  });
  return { requiredApprovalGates, findings, verdict: "PASS_WITH_WARNINGS" as ProviderActionVerdict };
}
