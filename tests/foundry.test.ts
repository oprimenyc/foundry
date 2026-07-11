import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { createProject, createPlanForProject, createRunForProject, getRunView, listRunEvents, persistenceHealth, seedMockCredentials } from "@/lib/foundry/service";
import { executeRun, requestRollback, resumeIncompleteRuns } from "@/lib/foundry/execution";
import { getSecretsService } from "@/lib/foundry/credentials";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { GET as healthzRoute } from "@/app/api/healthz/route";
import { getProviderAdapter, listRegisteredProviders, registerProviderAdapter, type ProviderAdapter } from "@/lib/foundry/providers";
import { ProviderRegistry, UnknownProviderError, DuplicateProviderError } from "@/lib/foundry/registry";

const testDir = path.join(process.cwd(), ".foundry-test-data");

async function resetEnv(name: string) {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, `${name}.json`);
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  await mkdir(testDir, { recursive: true });
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });
}

async function waitForTerminal(runId: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snapshot = await getStoreSnapshot();
    const run = snapshot.runs.find((item) => item.id === runId);
    if (run && ["completed", "failed", "cancelled", "rolled_back"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Run ${runId} did not reach terminal state`);
}

function validDraftPlan() {
  return {
    config: {
      name: "Test App",
      hosting: "vercel",
      repository: "test-app-repo",
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
        config: { repositoryName: "test-app-repo" },
        timeoutMs: 15000,
        retryLimit: 1,
        rollbackAction: "create_repository",
      },
      {
        id: "github-verify",
        provider: "github",
        action: "verify_repository",
        name: "Verify repository",
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
        config: { projectName: "test-app", credentialRef: "secret:vercel-token" },
        timeoutMs: 15000,
        retryLimit: 1,
        rollbackAction: "create_project",
      },
      {
        id: "vercel-deploy",
        provider: "vercel",
        action: "trigger_deployment",
        name: "Deploy to Vercel",
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
  };
}

test("invalid planner output is rejected", async () => {
  await resetEnv("invalid-plan");
  const project = await createProject({ name: "Invalid Plan", prompt: "Launch invalid plan app" });
  const { plan } = await createPlanForProject({
    projectId: project.id,
    prompt: project.prompt,
    draftPlan: {
      config: { name: "Broken", hosting: "vercel", repository: "broken" },
      steps: [
        {
          id: "bad",
          provider: "vercel",
          action: "create_project",
          name: "Bad step",
          dependsOn: ["bad"],
          config: { projectName: "broken" },
          timeoutMs: 1000,
          retryLimit: 1,
        },
      ],
    },
  });
  assert.equal(plan.status, "rejected");
  assert.ok(plan.validationErrors.length > 0);
});

test("run creation route returns 201 project and durable records persist", async () => {
  await resetEnv("project-route");
  const req = new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Route Test", prompt: "Launch route test app on Vercel" }),
  });
  const response = await createProjectRoute(req as any);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(typeof body.id, "string");
  const snapshot = await getStoreSnapshot();
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.credentials.length, 2);
});

test("full mocked project-to-deployment path completes and persists evidence", async () => {
  await resetEnv("happy-path");
  const project = await createProject({ name: "Happy Path", prompt: "Launch happy path app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  assert.equal(plan.status, "validated");
  const run = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "happy-key" });
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "completed");

  const view = await getRunView(project.id, run.id);
  assert.ok(view);
  assert.equal(view?.steps.filter((step) => step.status === "completed").length, 5);
  assert.equal(view?.evidence[0]?.result, "passed");

  const snapshot = await getStoreSnapshot();
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.plans.length, 1);
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.events.some((event) => event.status === "completed"), true);
  assert.equal(snapshot.runs[0].providerReferences.githubRepoUrl.startsWith("https://github.com/mock-org/"), true);
  assert.equal(snapshot.runs[0].providerReferences.vercelDeploymentUrl.includes(".mock-vercel.app"), true);
});

test("logs replay in order and duplicate idempotency key does not duplicate resources", async () => {
  await resetEnv("replay");
  const project = await createProject({ name: "Replay", prompt: "Launch replay app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "same-key" });
  const run2 = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "same-key" });
  assert.equal(run.id, run2.id);
  await waitForTerminal(run.id);
  const allEvents = await listRunEvents(run.id, 0);
  const replayed = await listRunEvents(run.id, 2);
  assert.ok(allEvents.length > replayed.length);
  assert.deepEqual(
    replayed.map((event) => event.sequence),
    replayed.map((event) => event.sequence).sort((a, b) => a - b)
  );
});

test("rollback executes compensation in reverse", async () => {
  await resetEnv("rollback");
  const project = await createProject({ name: "Rollback", prompt: "Launch rollback app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "rollback-key" });
  await waitForTerminal(run.id);
  await requestRollback(run.id);
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "rolled_back");
  const snapshot = await getStoreSnapshot();
  assert.equal(snapshot.steps.filter((step) => step.runId === run.id && step.status === "rolled_back").length >= 2, true);
  assert.equal(snapshot.rollbacks.filter((item) => item.runId === run.id && item.status === "completed").length >= 2, true);
});

test("restart resumes safely from queued run", async () => {
  await resetEnv("resume");
  const project = await createProject({ name: "Resume", prompt: "Launch resume app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "resume-key" });
  resetFoundryPersistence();
  await resumeIncompleteRuns();
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "completed");
});

test("encrypted secrets round-trip and public health contains no secret material", async () => {
  await resetEnv("secrets");
  const secrets = getSecretsService();
  const encrypted = await secrets.encryptSecret("super-secret-token");
  const decrypted = await secrets.decryptSecret(encrypted);
  assert.equal(decrypted, "super-secret-token");
  const health = await healthzRoute();
  const body = await health.json();
  assert.equal(body.persistence, "file");
  assert.equal(JSON.stringify(body).includes("super-secret-token"), false);
});

test("unknown provider fails closed", async () => {
  assert.throws(() => getProviderAdapter("openshift-legacy"), UnknownProviderError);
});

test("registry lookup is deterministic", async () => {
  const first = listRegisteredProviders("repository");
  const second = listRegisteredProviders("repository");
  assert.deepEqual(first, second);
  assert.deepEqual(first, [...first].sort());
});

test("new provider registers without modifying core registry code", async () => {
  const before = listRegisteredProviders("deployment");
  const fakeProvider: ProviderAdapter = {
    provider: `test-cloud-${randomUUIDForTest()}`,
    capability: "deployment",
    actions: ["create_project"],
    async execute() {
      return { providerReference: "test-ref", output: {} };
    },
  };
  registerProviderAdapter(fakeProvider);
  const after = listRegisteredProviders("deployment");
  assert.equal(after.length, before.length + 1);
  assert.equal(getProviderAdapter(fakeProvider.provider), fakeProvider);
});

test("adapter contract is enforced: duplicate registration is rejected", async () => {
  const registry = new ProviderRegistry<{ provider: string }>("test-capability");
  registry.register({ provider: "dup" });
  assert.throws(() => registry.register({ provider: "dup" }), DuplicateProviderError);
});

test("existing mocked github/vercel providers still resolve through the registry", async () => {
  const github = getProviderAdapter("github");
  const vercel = getProviderAdapter("vercel");
  assert.equal(github.capability, "repository");
  assert.equal(vercel.capability, "deployment");
});

function randomUUIDForTest() {
  return Math.random().toString(36).slice(2);
}

test("missing production master key fails closed for secret initialization", async () => {
  await resetEnv("master-key");
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.FOUNDRY_MASTER_KEY;
  assert.rejects(async () => getSecretsService(), /FOUNDRY_MASTER_KEY/);
  const health = await persistenceHealth();
  assert.equal(health.productionSafe, false);
});
