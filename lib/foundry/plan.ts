import { z } from "zod";
import type { DeploymentPlanRecord, DeploymentPlanStepRecord } from "./types";
import { getProviderAdapter } from "./providers";
import { UnknownProviderError } from "./registry";
import { selectProvider } from "./universal/selection";
import { NoEligibleProviderError, type TenantPolicy } from "./universal/types";

const PlanStepSchema = z.object({
  id: z.string().min(1),
  // "auto" delegates vendor choice to the selection engine via `category`.
  provider: z.string().min(1),
  category: z.string().min(1).optional(),
  action: z.string().min(1).max(64),
  name: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  config: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  timeoutMs: z.number().int().positive().max(120000).default(15000),
  retryLimit: z.number().int().min(0).max(3).default(1),
  rollbackAction: z.string().min(1).max(64).optional(),
  approvalRequired: z.boolean().optional(),
});

export const DraftPlanSchema = z.object({
  config: z.object({
    name: z.string().min(1),
    hosting: z.string().min(1),
    repository: z.string().min(1),
  }),
  budget: z
    .object({
      maxSteps: z.number().int().positive().max(10).default(5),
      maxRuntimeMs: z.number().int().positive().max(600000).default(120000),
    })
    .default({ maxSteps: 5, maxRuntimeMs: 120000 }),
  steps: z.array(PlanStepSchema).min(1).max(10),
});

export type DraftPlan = z.infer<typeof DraftPlanSchema>;

export function validateDraftPlan(
  draft: unknown,
  options: { tenantPolicy?: TenantPolicy } = {}
): { ok: true; plan: DraftPlan } | { ok: false; errors: string[] } {
  const parsed = DraftPlanSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }

  const plan = parsed.data;
  const errors: string[] = [];
  const stepIds = new Set(plan.steps.map((step) => step.id));

  // Provider-agnostic steps: `provider: "auto"` + `category` lets the
  // selection engine choose the vendor. Fails closed with every rejection
  // reason when no provider is eligible.
  for (const step of plan.steps) {
    if (step.provider !== "auto") continue;
    if (!step.category) {
      errors.push(`step ${step.id} uses provider "auto" but declares no category`);
      continue;
    }
    try {
      const decision = selectProvider({ category: step.category, action: step.action, tenantPolicy: options.tenantPolicy });
      step.provider = decision.providerId;
      step.config = { ...step.config, selectedBy: decision.engineVersion };
    } catch (error) {
      if (error instanceof NoEligibleProviderError) errors.push(`step ${step.id}: ${error.message}`);
      else throw error;
    }
  }

  if (plan.steps.length > plan.budget.maxSteps) {
    errors.push("steps exceed execution budget");
  }

  for (const step of plan.steps) {
    try {
      const adapter = getProviderAdapter(step.provider);
      if (!adapter.actions.includes(step.action)) {
        errors.push(`unsupported action ${step.action} for provider ${step.provider}`);
      }
    } catch (error) {
      if (error instanceof UnknownProviderError) {
        errors.push(`unknown provider ${step.provider}`);
      } else {
        throw error;
      }
    }
    for (const dep of step.dependsOn) {
      if (!stepIds.has(dep)) errors.push(`step ${step.id} depends on missing step ${dep}`);
    }
    // Steps marked approvalRequired are NOT rejected: the execution engine
    // pauses at them (RunStatus "awaiting_approval") and resumes on a human
    // decision. See lib/foundry/human-gates.ts.
    if (step.action === "create_repository" && typeof step.config.repositoryName !== "string") {
      errors.push(`step ${step.id} missing repositoryName`);
    }
    if (step.action === "create_project" && typeof step.config.projectName !== "string") {
      errors.push(`step ${step.id} missing projectName`);
    }
    const hasSecretValue = Object.values(step.config).some((value) => typeof value === "string" && value.startsWith("secret:"));
    if (!hasSecretValue && step.action === "create_project") {
      errors.push(`step ${step.id} must use secret references only for provider credentials`);
    }
  }

  detectCycle(plan.steps, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan };
}

function detectCycle(steps: DeploymentPlanStepRecord[], errors: string[]) {
  const temp = new Set<string>();
  const perm = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));

  const visit = (id: string) => {
    if (perm.has(id)) return;
    if (temp.has(id)) {
      errors.push(`circular dependency detected at ${id}`);
      return;
    }
    temp.add(id);
    const step = byId.get(id);
    if (step) {
      for (const dep of step.dependsOn) visit(dep);
    }
    temp.delete(id);
    perm.add(id);
  };

  for (const step of steps) visit(step.id);
}

export function toExecutionPlan(record: DeploymentPlanRecord) {
  const byId = new Map(record.steps.map((step) => [step.id, step]));
  const ordered: DeploymentPlanStepRecord[] = [];
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step) return;
    for (const dep of step.dependsOn) visit(dep);
    visited.add(id);
    ordered.push(step);
  };

  for (const step of record.steps) visit(step.id);
  return ordered;
}
