import { randomUUID } from "crypto";
import { generateDeploymentPlan } from "@/lib/ai/planner";
import { createPlanRecord, createProjectRecord, createRunRecord, getFoundryPersistence, getStoreSnapshot, insertRecord } from "./store";
import { DraftPlanSchema, validateDraftPlan } from "./plan";
import { startRunExecution } from "./execution";
import type { DeploymentPlanRecord, DeploymentRunRecord, ProjectRecord } from "./types";
import { upsertProviderCredential } from "./credentials";
import { listRegisteredProviders } from "./providers";

const DEFAULT_ORG_ID = "org_local";

export async function createProject(input: { name: string; prompt: string }) {
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const project = createProjectRecord({
    orgId: DEFAULT_ORG_ID,
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
  prompt: string;
  draftPlan?: unknown;
}) {
  const project = await requireProject(input.projectId);
  const draft = input.draftPlan || (await generatePlanDraft(input.prompt, project));
  const validation = validateDraftPlan(draft);
  const plan = createPlanRecord({
    projectId: project.id,
    prompt: input.prompt,
    status: validation.ok ? "validated" : "rejected",
    config: validation.ok
      ? validation.plan.config
      : { name: project.name, hosting: "vercel", repository: `${project.slug}-repo` },
    budget: validation.ok ? validation.plan.budget : { maxSteps: 0, maxRuntimeMs: 0 },
    steps: validation.ok ? validation.plan.steps : [],
    validationErrors: validation.ok ? [] : validation.errors,
  });
  await insertRecord("plans", plan);
  return { project, plan };
}

async function generatePlanDraft(prompt: string, project: ProjectRecord) {
  const generated = await generateDeploymentPlan(prompt);
  return DraftPlanSchema.parse({
    config: {
      name: generated.config.name,
      hosting: generated.config.hosting,
      repository: `${project.slug}-repo`,
    },
    budget: {
      maxSteps: 5,
      maxRuntimeMs: 120000,
    },
    steps: [
      {
        id: "github-create",
        provider: "github",
        action: "create_repository",
        name: "Create GitHub repository",
        dependsOn: [],
        config: {
          repositoryName: `${project.slug}-repo`,
        },
        timeoutMs: 15000,
        retryLimit: 1,
        rollbackAction: "create_repository",
      },
      {
        id: "github-verify",
        provider: "github",
        action: "verify_repository",
        name: "Verify GitHub repository",
        dependsOn: ["github-create"],
        config: {},
        timeoutMs: 5000,
        retryLimit: 0,
      },
      {
        id: "vercel-create",
        provider: "vercel",
        action: "create_project",
        name: "Create Vercel project",
        dependsOn: ["github-verify"],
        config: {
          projectName: project.slug,
          credentialRef: "secret:vercel-token",
        },
        timeoutMs: 15000,
        retryLimit: 1,
        rollbackAction: "create_project",
      },
      {
        id: "vercel-deploy",
        provider: "vercel",
        action: "trigger_deployment",
        name: "Trigger Vercel deployment",
        dependsOn: ["vercel-create"],
        config: {},
        timeoutMs: 15000,
        retryLimit: 1,
      },
      {
        id: "vercel-verify",
        provider: "vercel",
        action: "verify_deployment",
        name: "Verify deployment",
        dependsOn: ["vercel-deploy"],
        config: {},
        timeoutMs: 5000,
        retryLimit: 0,
      },
    ],
  });
}

export async function createRunForProject(input: {
  projectId: string;
  planId: string;
  idempotencyKey?: string;
}): Promise<DeploymentRunRecord> {
  const health = await persistenceHealth();
  if (process.env.NODE_ENV === "production" && !health.productionSafe) {
    throw new Error("Production execution requires durable configured persistence");
  }
  const project = await requireProject(input.projectId);
  const plan = await requirePlan(input.planId);
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
  });
  await insertRecord("runs", run);
  await startRunExecution(run.id);
  return run;
}

export async function listRunEvents(runId: string, afterSequence = 0) {
  const snapshot = await getStoreSnapshot();
  return snapshot.events
    .filter((event) => event.runId === runId && event.sequence > afterSequence)
    .sort((a, b) => a.sequence - b.sequence);
}

export async function getRunView(projectId: string, runId: string) {
  const snapshot = await getStoreSnapshot();
  const run = snapshot.runs.find((item) => item.id === runId && item.projectId === projectId);
  if (!run) return null;
  return {
    run,
    steps: snapshot.steps.filter((step) => step.runId === runId),
    evidence: snapshot.evidence.filter((item) => item.runId === runId),
  };
}

export async function seedMockCredentials(projectId: string) {
  const project = await requireProject(projectId);
  const githubToken = process.env.GITHUB_TOKEN || "mock-github-token";
  const vercelToken = process.env.VERCEL_API_TOKEN || "mock-vercel-token";
  await upsertProviderCredential({
    orgId: project.orgId,
    projectId: project.id,
    provider: "github",
    purpose: "deployment",
    plaintextSecret: githubToken,
  });
  await upsertProviderCredential({
    orgId: project.orgId,
    projectId: project.id,
    provider: "vercel",
    purpose: "deployment",
    plaintextSecret: vercelToken,
  });
}

export async function persistenceHealth() {
  return {
    mode: getFoundryPersistence().mode(),
    productionSafe: process.env.NODE_ENV !== "production" || getFoundryPersistence().mode() === "supabase",
  };
}

async function requireProject(projectId: string) {
  const project = (await getStoreSnapshot()).projects.find((item) => item.id === projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project;
}

async function requirePlan(planId: string) {
  const plan = (await getStoreSnapshot()).plans.find((item) => item.id === planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  return plan;
}

export function getSupportedProviders(): string[] {
  return listRegisteredProviders();
}
