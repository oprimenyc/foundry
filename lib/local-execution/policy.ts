import {
  FORBIDDEN_COMMAND_CLASSES,
  HIGH_RISK_DOMAINS,
  type CommandRecord,
  type Criticality,
  type EscalationReason,
  type LocalExecutionVerdict,
  type PolicyEvaluation,
  type PolicyFinding,
  type ProviderMutationGateRef,
} from "./types";

/**
 * Pure policy engine (mirrors lib/secret-remediation's plan/verdict split):
 * given normalized facts about one local-worker run, decide whether the
 * scope was respected and what verdict that earns. Never executes anything;
 * never mutates a gate. A local-only PASS is capped as advisory — see
 * requiresIndependentVerification in types.ts — this function only decides
 * the *local* verdict.
 */

function matchesScope(filePath: string, allowedFileScope: string[]): boolean {
  return allowedFileScope.some((scope) => filePath === scope || filePath.startsWith(scope.endsWith("/") ? scope : `${scope}/`) || filePath.startsWith(scope));
}

export function findOutOfScopeFiles(filesTouched: string[], allowedFileScope: string[]): string[] {
  return filesTouched.filter((file) => !matchesScope(file, allowedFileScope));
}

export interface EvaluateLocalExecutionPolicyInput {
  criticality: Criticality;
  commandsRun: CommandRecord[];
  filesTouched: string[];
  allowedFileScope: string[];
  proofArtifacts: string[];
  providerMutationOccurred: boolean;
  providerMutationGate?: ProviderMutationGateRef;
  sourceMutationOccurred: boolean;
  secretScanOk: boolean;
}

/**
 * Deterministic verdict rule, evaluated over every finding (never a single
 * early-exit that hides a later, more severe one):
 *  - a forbidden command class, an out-of-scope file mutation, or a failed
 *    secret scan is always blocking;
 *  - an unapproved (or unreferenced) provider mutation is always blocking —
 *    Foundry never treats a local worker's own claim of success as
 *    sufficient authority to have mutated a provider;
 *  - touching a high-risk domain (auth/billing/security/deploy/database)
 *    always requires frontier review and escalation, regardless of outcome;
 *  - missing proof artifacts is blocking at high/critical criticality, a
 *    warning otherwise;
 *  - a run where every command failed is unreviewable (no evidence a local
 *    execution actually happened — e.g. tool not installed) — a partial
 *    failure is only a warning, nothing here silently hides either case;
 *  - a run whose wall-clock time exceeds a fixed threshold is flagged as
 *    slow (warning) — informational, never blocking on its own.
 */
export function evaluateLocalExecutionPolicy(input: EvaluateLocalExecutionPolicyInput): PolicyEvaluation {
  const findings: PolicyFinding[] = [];
  const requiredEscalations = new Set<EscalationReason>();
  let frontierReviewRequired = false;

  const forbidden = input.commandsRun.filter((c) => FORBIDDEN_COMMAND_CLASSES.includes(c.commandClass));
  if (forbidden.length > 0) {
    findings.push({
      code: "FORBIDDEN_COMMAND_CLASS",
      severity: "blocking",
      message: `forbidden command class(es) present: ${forbidden.map((c) => c.commandClass).join(", ")}`,
    });
    requiredEscalations.add("forbidden_command_class");
  }

  const outOfScope = findOutOfScopeFiles(input.filesTouched, input.allowedFileScope);
  if (outOfScope.length > 0) {
    findings.push({
      code: "OUT_OF_SCOPE_FILE_MUTATION",
      severity: "blocking",
      message: `file(s) touched outside the allowed scope: ${outOfScope.join(", ")}`,
    });
    requiredEscalations.add("out_of_scope_file_mutation");
  }

  if (!input.secretScanOk) {
    findings.push({ code: "SECRET_EXPOSURE_IN_EVIDENCE", severity: "block", message: "secret-shaped material detected in the evidence submission — unreviewable" });
  }

  if (input.providerMutationOccurred) {
    if (!input.providerMutationGate || !input.providerMutationGate.approved) {
      findings.push({
        code: "PROVIDER_MUTATION_REQUIRES_APPROVAL",
        severity: "block",
        message: input.providerMutationGate
          ? `provider mutation claimed under gate ${input.providerMutationGate.gateId}, which is not yet approved`
          : "provider mutation claimed with no approval gate referenced",
      });
      requiredEscalations.add("provider_mutation_requires_approval");
    }
  }

  const highRiskCommands = input.commandsRun.filter((c) => (HIGH_RISK_DOMAINS as readonly string[]).includes(c.commandClass));
  if (highRiskCommands.length > 0 || (input.sourceMutationOccurred && input.providerMutationOccurred)) {
    frontierReviewRequired = true;
    requiredEscalations.add("high_risk_domain_touched");
    if (highRiskCommands.length > 0) {
      findings.push({
        code: "HIGH_RISK_DOMAIN_TOUCHED",
        severity: "block",
        message: `high-risk domain command class(es) present, frontier review required: ${highRiskCommands.map((c) => c.commandClass).join(", ")}`,
      });
    }
  }

  if (input.proofArtifacts.length === 0) {
    const blocking = input.criticality === "high" || input.criticality === "critical";
    findings.push({
      code: "MISSING_PROOF_ARTIFACTS",
      severity: blocking ? "blocking" : "warning",
      message: `no proof artifacts attached for a ${input.criticality}-criticality run`,
    });
    if (blocking) requiredEscalations.add("missing_proof_at_criticality");
  }

  const failedCommands = input.commandsRun.filter((c) => c.exitCode !== 0);
  if (failedCommands.length > 0 && failedCommands.length === input.commandsRun.length) {
    // Every single command failed: there is no evidence a local execution actually
    // happened (tool not installed, install blocked, ...) — unreviewable, not a partial pass.
    findings.push({
      code: "ALL_COMMANDS_FAILED",
      severity: "block",
      message: `all ${input.commandsRun.length} command(s) exited non-zero — no successful local execution occurred`,
    });
  } else if (failedCommands.length > 0) {
    findings.push({
      code: "NON_ZERO_EXIT_CODE",
      severity: "warning",
      message: `${failedCommands.length} of ${input.commandsRun.length} command(s) exited non-zero`,
    });
  }

  const SLOW_EXECUTION_THRESHOLD_MS = 120_000;
  const slowCommands = input.commandsRun.filter((c) => c.wallClockMs > SLOW_EXECUTION_THRESHOLD_MS);
  if (slowCommands.length > 0) {
    findings.push({
      code: "SLOW_EXECUTION_DETECTED",
      severity: "warning",
      message: `${slowCommands.length} command(s) exceeded the ${SLOW_EXECUTION_THRESHOLD_MS}ms local-execution wall-clock threshold`,
    });
  }

  const verdict = computeVerdict(findings);
  return { ok: verdict === "PASS" || verdict === "PASS_WITH_WARNINGS", findings, requiredEscalations: Array.from(requiredEscalations), frontierReviewRequired, verdict };
}

function computeVerdict(findings: PolicyFinding[]): LocalExecutionVerdict {
  if (findings.some((f) => f.severity === "block")) return "BLOCKED";
  if (findings.some((f) => f.severity === "blocking")) return "FAIL";
  if (findings.some((f) => f.severity === "warning")) return "PASS_WITH_WARNINGS";
  return "PASS";
}
