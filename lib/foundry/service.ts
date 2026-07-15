import { randomUUID } from "crypto";
import { generateDeploymentPlan } from "@/lib/ai/planner";
import { createPlanRecord, createProjectRecord, createRunRecord, getFoundryPersistence, getStoreSnapshot, insertRecord } from "./store";
import { DraftPlanSchema, validateDraftPlan } from "./plan";
import { startRunExecution } from "./execution";
import type { DeploymentPlanRecord, DeploymentRunRecord, ProjectRecord } from "./types";
import { upsertProviderCredential } from "./credentials";
import { listRegisteredProviders } from "./providers";
import { selectProvider } from "./universal/selection";
import { universalRegistry } from "./universal/registry";
import { NoEligibleProviderError } from "./universal/types";

/** Thrown when a resource does not exist in the caller's org scope. Routes map it to 404 (no cross-org enumeration). */
export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

export async function createProject(input: { name: string; prompt: string; orgId: string; requestedBy?: string }) {
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const project = createProjectRecord({
    orgId: input.orgId,
    name: input.name,
    slug,
    prompt: input.prompt,
    status: "draft",
  });
  await insertRecord("projects", project);
  return project;
}

export async function createPlanForProject(input: {
  projectId: string;
  orgId: string;
  prompt: string;
  draftPlan?: unknown;
}) {
  const project = await requireProject(input.projectId, input.orgId);
  const draft = input.draftPlan || (await generatePlanDraft(input.prompt, project));
  const validation = validateDraftPlan(draft);
  const plan = createPlanRecord({
    projectId: project.id,
    prompt: input.prompt,
    status: validation.ok ? "validated" : "rejected",
    config: validation.ok
      ? validation.plan.config
      : { name: project.name, hosting: safeSelect("hosting", "create_project"), repository: `${project.slug}-repo` },
    budget: validation.ok ? validation.plan.budget : { maxSteps: 0, maxRuntimeMs: 0 },
    steps: validation.ok ? validation.plan.steps : [],
    validationErrors: validation.ok ? [] : validation.errors,
  });
  await insertRecord("plans", plan);
  return { project, plan };
}

/** Selection that reads as a value, not a crash, when nothing is eligible. */
function safeSelect(category: string, action: string): string {
  try {
    return selectProvider({ category, action }).providerId;
  } catch (error) {
    if (error instanceof NoEligibleProviderError) return "unresolved";
    throw error;
  }
}

/**
 * Provider-agnostic launch pipeline: the planner (and this scaffold) declare
 * capability categories only; the selection engine resolves vendors during
 * validation (`provider: "auto"`).
 */
async function generatePlanDraft(prompt: string, project: ProjectRecord) {
  const generated = await generateDeploymentPlan(prompt);
  return DraftPlanSchema.parse({
    config: {
      name: generated.config.name,
      hosting: safeSelect("hosting", "create_project"),
      repository: `${project.slug}-repo`,
    },
    budget: {
      maxSteps: 5,
      maxRuntimeMs: 120000,
    },
    steps: [
      {
        id: "repository-create",
        provider: "auto",
        category: "repository",
        action: "create_repository",
        name: "Create repository",
        dependsOn: [],
        config: {
          repositoryName: `${project.slug}-repo`,
        },
        timeoutMs: 15000,
        retryLimit: 1,
        rollbackAction: "create_repository",
      },
      {
        id: "repository-verify",
        provider: "auto",
        category: "repository",
        action: "verify_repository",
        name: "Verify repository",
        dependsOn: ["repository-create"],
        config: {},
        timeoutMs: 5000,
        retryLimit: 0,
      },
      {
        id: "hosting-create",
        provider: "auto",
        category: "hosting",
        action: "create_project",
        name: "Create hosting project",
        dependsOn: ["repository-verify"],
        config: {
          projectName: project.slug,
          credentialRef: "secret:hosting/execution",
        },
        timeoutMs: 15000,
        retryLimit: 1,
        rollbackAction: "create_project",
      },
      {
        id: "hosting-deploy",
        provider: "auto",
        category: "hosting",
        action: "trigger_deployment",
        name: "Trigger deployment",
        dependsOn: ["hosting-create"],
        config: {},
        timeoutMs: 15000,
        retryLimit: 1,
      },
      {
        id: "hosting-verify",
        provider: "auto",
        category: "hosting",
        action: "verify_deployment",
        name: "Verify deployment",
        dependsOn: ["hosting-deploy"],
        config: {},
        timeoutMs: 5000,
        retryLimit: 0,
      },
    ],
  });
}

export async function createRunForProject(input: {
  projectId: string;
  orgId: string;
  planId: string;
  idempotencyKey?: string;
  requestedBy?: string;
}): Promise<DeploymentRunRecord> {
  const health = await persistenceHealth();
  if (process.env.NODE_ENV === "production" && !health.productionSafe) {
    throw new Error("Production execution requires durable configured persistence");
  }
  const project = await requireProject(input.projectId, input.orgId);
  const plan = await requirePlan(input.planId);
  if (plan.projectId !== project.id) throw new ScopeError("Plan does not belong to this project");
  if (plan.status !== "validated") {
    throw new Error("Plan is not validated");
  }
  const idempotencyKey = input.idempotencyKey || randomUUID();
  const snapshot = await getStoreSnapshot();
  const existing = snapshot.runs.find((run) => run.projectId === project.id && run.idempotencyKey === idempotencyKey);
  if (existing) return existing;

  const run = createRunRecord({
    projectId: project.id,
    planId: plan.id,
    status: "queued",
    progress: 0,
    retryCount: 0,
    idempotencyKey,
    rollbackStatus: "not_required",
    providerReferences: {},
    evidenceReferences: [],
    requestedBy: input.requestedBy,
  });
  await insertRecord("runs", run);
  await startRunExecution(run.id);
  return run;
}

export async function listRunEvents(runId: string, afterSequence = 0, orgId?: string) {
  const snapshot = await getStoreSnapshot();
  if (orgId !== undefined) {
    const run = snapshot.runs.find((item) => item.id === runId);
    const project = run && snapshot.projects.find((item) => item.id === run.projectId);
    if (!project || project.orgId !== orgId) throw new ScopeError(`Run ${runId} not found`);
  }
  return snapshot.events
    .filter((event) => event.runId === runId && event.sequence > afterSequence)
    .sort((a, b) => a.sequence - b.sequence);
}

export async function getRunView(projectId: string, runId: string, orgId?: string) {
  const snapshot = await getStoreSnapshot();
  const project = snapshot.projects.find((item) => item.id === projectId);
  if (orgId !== undefined && (!project || project.orgId !== orgId)) return null;
  const run = snapshot.runs.find((item) => item.id === runId && item.projectId === projectId);
  if (!run) return null;
  return {
    run,
    steps: snapshot.steps.filter((step) => step.runId === runId),
    evidence: snapshot.evidence.filter((item) => item.runId === runId),
    evidenceManifests: snapshot.evidenceManifests.filter((item) => item.executionId === run.idempotencyKey),
    verifications: snapshot.verifications.filter((item) => item.runId === runId),
  };
}

/**
 * Seeds credentials for the providers the selection engine would choose for
 * the default launch pipeline — provider-agnostic: no vendor names here.
 * Secrets come from the provider's declared credential env vars, or a mock
 * placeholder in non-production.
 */
export async function seedMockCredentials(projectId: string, orgId?: string) {
  const project = await requireProject(projectId, orgId);
  const needs: Array<{ category: string; action: string }> = [
    { category: "repository", action: "create_repository" },
    { category: "hosting", action: "create_project" },
  ];
  for (const need of needs) {
    const decision = selectProvider({ category: need.category, action: need.action });
    const manifest = universalRegistry.get(decision.providerId).manifest;
    const secret =
      manifest.requiredCredentials.map((key) => process.env[key]).find(Boolean) ||
      `mock-${decision.providerId}-token`;
    await upsertProviderCredential({
      orgId: project.orgId,
      projectId: project.id,
      provider: decision.providerId,
      purpose: "execution",
      plaintextSecret: secret,
    });
  }
}

export async function persistenceHealth() {
  let persistence: ReturnType<typeof getFoundryPersistence>;
  try {
    persistence = getFoundryPersistence();
  } catch (error) {
    // Misconfiguration (e.g. unknown FOUNDRY_PERSISTENCE) reports as unhealthy instead of crashing health checks.
    return {
      mode: "unavailable" as const,
      reachable: false,
      probeError: error instanceof Error ? error.message : String(error),
      productionSafe: false,
    };
  }
  let reachable = true;
  let probeError: string | undefined;
  try {
    await persistence.probe();
  } catch (error) {
    reachable = false;
    probeError = error instanceof Error ? error.message : String(error);
  }
  return {
    mode: persistence.mode(),
    reachable,
    ...(probeError ? { probeError } : {}),
    productionSafe: reachable && (process.env.NODE_ENV !== "production" || persistence.productionSafe()),
  };
}

async function requireProject(projectId: string, orgId?: string) {
  const project = (await getStoreSnapshot()).projects.find((item) => item.id === projectId);
  // Cross-org access reads identically to nonexistence: no enumeration signal.
  if (!project || (orgId !== undefined && project.orgId !== orgId)) {
    throw new ScopeError(`Project ${projectId} not found`);
  }
  return project;
}

/** Authorizes run-level operations (cancel/rollback/view) for an org scope. */
export async function authorizeRunAccess(projectId: string, runId: string, orgId: string) {
  const snapshot = await getStoreSnapshot();
  const project = snapshot.projects.find((item) => item.id === projectId);
  const run = snapshot.runs.find((item) => item.id === runId && item.projectId === projectId);
  if (!project || project.orgId !== orgId || !run) {
    throw new ScopeError(`Run ${runId} not found`);
  }
  return run;
}

async function requirePlan(planId: string) {
  const plan = (await getStoreSnapshot()).plans.find((item) => item.id === planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  return plan;
}

export function getSupportedProviders(): string[] {
  return listRegisteredProviders();
}
