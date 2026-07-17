import { z } from "zod";
import { validateDraftPlan, DraftPlanSchema } from "./plan";
import { resolveExecutionMode, type RoutingDecision } from "./routing";
import { classifyActionRisk } from "@/lib/vault/policy";
import type { TenantPolicy } from "./universal/types";

/**
 * Execution envelope intake (Mission 1).
 *
 * The canonical, validated input boundary for a governed execution or release.
 * An envelope wraps a deployment plan draft with the governance metadata
 * Foundry needs to decide WHETHER and HOW to execute: target environment,
 * write boundary, approval policy, idempotency, evidence/verification/rollback
 * requirements, timeout/retry, expiry, and orchestrator provenance.
 *
 * Intake NEVER executes. It returns one of four decisions and, when gates are
 * required, the exact steps that will pause for a human.
 */

const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(5).default(1),
  timeoutMs: z.number().int().positive().max(600000).default(120000),
});

export const ExecutionEnvelopeSchema = z.object({
  envelopeId: z.string().min(1),
  missionId: z.string().min(1).optional(),
  projectRef: z.string().min(1),
  requestedOperation: z.enum(["deploy", "provision", "configure", "release", "rollback", "verify"]),
  targetEnvironment: z.enum(["development", "test", "preview", "staging", "production"]),
  /** Paths this envelope is permitted to write. Empty = no filesystem writes claimed. */
  writeBoundary: z.array(z.string()).default([]),
  /** Approval requirements declared by the orchestrator (in addition to policy-derived gates). */
  approvalRequirements: z
    .array(z.object({ stepId: z.string(), reason: z.string() }))
    .default([]),
  idempotencyKey: z.string().min(1),
  evidenceRequired: z.boolean().default(true),
  verificationRequired: z.boolean().default(true),
  rollbackRequired: z.boolean().default(true),
  retryPolicy: RetryPolicySchema.default({ maxRetries: 1, timeoutMs: 120000 }),
  source: z.object({ orchestrator: z.string().min(1), reference: z.string().optional() }),
  /** ISO timestamp after which the envelope is stale and must be rejected. */
  expiresAt: z.string().datetime().optional(),
  /** The deployment plan draft to validate and execute. */
  plan: DraftPlanSchema,
});

export type ExecutionEnvelope = z.infer<typeof ExecutionEnvelopeSchema>;

export type EnvelopeDecision = "ACCEPTED" | "ACCEPTED_WITH_GATES" | "BLOCKED" | "REJECTED";

export interface EnvelopeGate {
  stepId: string;
  provider: string;
  action: string;
  riskLevel: string;
  reason: string;
}

export interface EnvelopeIntakeResult {
  decision: EnvelopeDecision;
  envelopeId: string;
  /** Validation/structural failures (→ REJECTED). */
  rejections: string[];
  /** Policy/authorization blocks (→ BLOCKED). */
  blocks: string[];
  /** Human gates that will pause execution (→ ACCEPTED_WITH_GATES). */
  gates: EnvelopeGate[];
  /** Per-step routing mode decisions. */
  routing: RoutingDecision[];
  reasons: string[];
  intakeVersion: string;
}

export const ENVELOPE_INTAKE_VERSION = "foundry-envelope-intake@1";

// Deny obvious shell/command-injection material in step config values.
const FORBIDDEN_COMMAND = /(\$\(|`|&&|\|\||;\s*rm\s|\brm\s+-rf\b|\bcurl\b.*\|\s*sh\b|\bwget\b.*\|\s*sh\b)/i;

const ENV_ALIAS: Record<string, "development" | "staging" | "production"> = {
  development: "development",
  test: "development",
  preview: "staging",
  staging: "staging",
  production: "production",
};

/**
 * Validate an execution envelope. Fail-closed and side-effect-free.
 *
 * `seenIdempotencyKeys` — keys already accepted for this project — lets intake
 * detect replay/duplicate submissions deterministically without reaching into
 * the store (the caller supplies them from persistence).
 */
export function intakeEnvelope(
  raw: unknown,
  options: { tenantPolicy?: TenantPolicy; seenIdempotencyKeys?: string[]; now?: Date } = {}
): EnvelopeIntakeResult {
  const now = options.now ?? new Date();
  const parsed = ExecutionEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return reject("unparseable-envelope", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const env = parsed.data;

  const rejections: string[] = [];
  const blocks: string[] = [];
  const gates: EnvelopeGate[] = [];
  const reasons: string[] = [];

  // Expiry — a stale envelope is rejected, never executed.
  if (env.expiresAt && env.expiresAt < now.toISOString()) {
    rejections.push(`envelope expired at ${env.expiresAt}`);
  }

  // Replay / duplicate detection.
  if (options.seenIdempotencyKeys?.includes(env.idempotencyKey)) {
    blocks.push(`idempotency key ${env.idempotencyKey} already accepted (replay/duplicate)`);
  }

  // Plan validation (structural + provider/action + budget + cycles + secret rule).
  const validation = validateDraftPlan(env.plan, { tenantPolicy: options.tenantPolicy });
  if (!validation.ok) {
    rejections.push(...validation.errors);
  }

  // Forbidden-command scan over every step config value.
  for (const step of env.plan.steps) {
    for (const [key, value] of Object.entries(step.config)) {
      if (typeof value === "string" && FORBIDDEN_COMMAND.test(value)) {
        rejections.push(`step ${step.id} config "${key}" contains a forbidden command pattern`);
      }
    }
    // Raw secrets must be references, never literals, for credential-shaped keys.
    for (const [key, value] of Object.entries(step.config)) {
      if (/(secret|token|password|api[_-]?key|credential)/i.test(key) && typeof value === "string" && value.length > 0 && !value.startsWith("secret:")) {
        blocks.push(`step ${step.id} config "${key}" must be a secret: reference, not a literal value`);
      }
    }
  }

  // Routing + risk-derived gates. Uses the validated (vendor-resolved) plan when
  // available, otherwise the raw declared providers.
  const planForRouting = validation.ok ? validation.plan : env.plan;
  const vaultEnv = ENV_ALIAS[env.targetEnvironment] ?? "development";
  const routing: RoutingDecision[] = [];
  const declaredApprovalStepIds = new Set(env.approvalRequirements.map((a) => a.stepId));

  for (const step of planForRouting.steps) {
    if (step.provider === "auto") continue; // unresolved (validation already failed)
    const decision = resolveExecutionMode({ providerId: step.provider, action: step.action, environment: vaultEnv });
    routing.push(decision);

    const risk = classifyActionRisk(step.action, vaultEnv);
    const needsGate = decision.requiresHumanGate || declaredApprovalStepIds.has(step.id) || (step as { approvalRequired?: boolean }).approvalRequired === true;
    if (needsGate) {
      gates.push({
        stepId: step.id,
        provider: step.provider,
        action: step.action,
        riskLevel: risk,
        reason:
          env.approvalRequirements.find((a) => a.stepId === step.id)?.reason ||
          decision.reasons.find((r) => r.includes("human")) ||
          `${risk}-risk ${step.action} requires human approval`,
      });
    }

    // A non-executable mode (e.g. browser with no driver) blocks unless it is a
    // human gate the caller will satisfy interactively.
    if (!decision.executable && decision.mode !== "HUMAN" && decision.mode !== "BROWSER") {
      blocks.push(`step ${step.id}: ${decision.mode} not executable — ${decision.reasons.join("; ")}`);
    }
  }

  if (rejections.length > 0) {
    return { decision: "REJECTED", envelopeId: env.envelopeId, rejections, blocks, gates, routing, reasons: ["envelope failed validation"], intakeVersion: ENVELOPE_INTAKE_VERSION };
  }
  if (blocks.length > 0) {
    return { decision: "BLOCKED", envelopeId: env.envelopeId, rejections, blocks, gates, routing, reasons: ["envelope blocked by policy"], intakeVersion: ENVELOPE_INTAKE_VERSION };
  }
  if (gates.length > 0) {
    reasons.push(`accepted with ${gates.length} human gate(s)`);
    return { decision: "ACCEPTED_WITH_GATES", envelopeId: env.envelopeId, rejections, blocks, gates, routing, reasons, intakeVersion: ENVELOPE_INTAKE_VERSION };
  }
  reasons.push("accepted for automatic execution");
  return { decision: "ACCEPTED", envelopeId: env.envelopeId, rejections, blocks, gates, routing, reasons, intakeVersion: ENVELOPE_INTAKE_VERSION };

  function reject(reason: string, errors: string[]): EnvelopeIntakeResult {
    return {
      decision: "REJECTED",
      envelopeId: typeof (raw as { envelopeId?: string })?.envelopeId === "string" ? (raw as { envelopeId: string }).envelopeId : "unknown",
      rejections: [reason, ...errors],
      blocks: [],
      gates: [],
      routing: [],
      reasons: ["envelope structurally invalid"],
      intakeVersion: ENVELOPE_INTAKE_VERSION,
    };
  }
}
