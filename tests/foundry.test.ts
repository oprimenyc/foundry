import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { createProject, createPlanForProject, createRunForProject, getRunView, listRunEvents, persistenceHealth, seedMockCredentials } from "@/lib/foundry/service";
import { executeRun, requestRollback, resumeIncompleteRuns } from "@/lib/foundry/execution";
import { getSecretsService } from "@/lib/foundry/credentials";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { POST as sessionLoginRoute } from "@/app/api/auth/session/route";
import { GET as healthzRoute } from "@/app/api/healthz/route";
import { getProviderAdapter, listRegisteredProviders, registerProviderAdapter, ProviderError, type ProviderAdapter } from "@/lib/foundry/providers";
import { ProviderRegistry, UnknownProviderError, DuplicateProviderError } from "@/lib/foundry/registry";

const testDir = path.join(process.cwd(), ".foundry-test-data");

async function resetEnv(name: string, mode: "file" | "sqlite" = "file") {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  delete process.env.FOUNDRY_API_TOKEN;
  process.env.FOUNDRY_PERSISTENCE = mode;
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, `${name}.json`);
  process.env.FOUNDRY_SQLITE_FILE = path.join(testDir, `${name}.sqlite`);
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  await mkdir(testDir, { recursive: true });
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });
  await rm(process.env.FOUNDRY_SQLITE_FILE, { force: true });
  await rm(`${process.env.FOUNDRY_SQLITE_FILE}-wal`, { force: true });
  await rm(`${process.env.FOUNDRY_SQLITE_FILE}-shm`, { force: true });
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

test("API routes require auth when FOUNDRY_API_TOKEN is set; bearer and session cookie both work", async () => {
  await resetEnv("auth-routes");
  process.env.FOUNDRY_API_TOKEN = "test-api-token-0123456789";
  const payload = { name: "Auth Test", prompt: "Launch auth test app on Vercel" };

  const anonymous = await createProjectRoute(
    new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }) as any
  );
  assert.equal(anonymous.status, 401);

  const bearer = await createProjectRoute(
    new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-api-token-0123456789" },
      body: JSON.stringify(payload),
    }) as any
  );
  assert.equal(bearer.status, 201);

  const cookie = await createProjectRoute(
    new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "foundry_session=test-api-token-0123456789" },
      body: JSON.stringify(payload),
    }) as any
  );
  assert.equal(cookie.status, 201);
});

test("session login validates the token and sets an httpOnly cookie", async () => {
  await resetEnv("auth-session");
  process.env.FOUNDRY_API_TOKEN = "test-api-token-0123456789";

  const bad = await sessionLoginRoute(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "wrong-token" }),
    }) as any
  );
  assert.equal(bad.status, 401);

  const good = await sessionLoginRoute(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test-api-token-0123456789" }),
    }) as any
  );
  assert.equal(good.status, 200);
  const setCookie = good.headers.get("set-cookie") || "";
  assert.match(setCookie, /foundry_session=/);
  assert.match(setCookie, /HttpOnly/i);
});

test("production API fails closed when FOUNDRY_API_TOKEN is missing", async () => {
  await resetEnv("auth-prod");
  Object.assign(process.env, { NODE_ENV: "production" });
  const res = await createProjectRoute(
    new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Prod Auth", prompt: "Launch prod auth app on Vercel" }),
    }) as any
  );
  assert.equal(res.status, 503);
  Object.assign(process.env, { NODE_ENV: "test" });
});

test("missing production master key fails closed for secret initialization", async () => {
  await resetEnv("master-key");
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.FOUNDRY_MASTER_KEY;
  assert.rejects(async () => getSecretsService(), /FOUNDRY_MASTER_KEY/);
  const health = await persistenceHealth();
  assert.equal(health.productionSafe, false);
  Object.assign(process.env, { NODE_ENV: "test" });
});

function retryPlan(provider: string) {
  return {
    config: { name: "Retry App", hosting: "vercel", repository: "retry-repo" },
    budget: { maxSteps: 5, maxRuntimeMs: 120000 },
    steps: [
      {
        id: "github-create",
        provider: "github",
        action: "create_repository",
        name: "Create repo",
        dependsOn: [],
        config: { repositoryName: "retry-repo" },
        timeoutMs: 15000,
        retryLimit: 1,
        rollbackAction: "create_repository",
      },
      {
        id: "flaky-step",
        provider,
        action: "create_project",
        name: "Flaky provider step",
        dependsOn: ["github-create"],
        config: { projectName: "retry-app", credentialRef: "secret:vercel/deployment" },
        timeoutMs: 500,
        retryLimit: 2,
      },
    ],
  };
}

test("retryable provider failure is retried and the run completes with retry evidence", async () => {
  await resetEnv("retry-success");
  let attempts = 0;
  const providerId = `flaky-then-ok-${randomUUIDForTest()}`;
  registerProviderAdapter({
    provider: providerId,
    capability: "deployment",
    actions: ["create_project"],
    async execute() {
      attempts += 1;
      if (attempts < 3) {
        throw new ProviderError("transient upstream 503", { retryable: true, category: "provider" });
      }
      return { providerReference: "flaky-ref", output: { projectId: "flaky-project" } };
    },
  });
  const project = await createProject({ name: "Retry Success", prompt: "Launch retry app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: retryPlan(providerId) });
  assert.equal(plan.status, "validated");
  const run = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "retry-ok" });
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "completed");
  assert.equal(attempts, 3);
  const snapshot = await getStoreSnapshot();
  const step = snapshot.steps.find((item) => item.runId === run.id && item.planStepId === "flaky-step");
  assert.equal(step?.retryCount, 2);
  const retryEvents = snapshot.events.filter((event) => event.runId === run.id && event.sanitizedMessage.startsWith("Retrying"));
  assert.equal(retryEvents.length, 2);
});

test("step timeout is enforced, classified, and exhausts retries into run failure", async () => {
  await resetEnv("retry-timeout");
  let attempts = 0;
  const providerId = `hangs-forever-${randomUUIDForTest()}`;
  registerProviderAdapter({
    provider: providerId,
    capability: "deployment",
    actions: ["create_project"],
    async execute() {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 60000));
      return { providerReference: "never", output: {} };
    },
  });
  const project = await createProject({ name: "Timeout", prompt: "Launch timeout app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: retryPlan(providerId) });
  const run = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "retry-timeout" });
  const terminal = await waitForTerminal(run.id, 15000);
  assert.equal(terminal.status, "failed");
  assert.equal(terminal.failureCategory, "timeout");
  assert.equal(attempts, 3); // initial attempt + retryLimit 2
  const snapshot = await getStoreSnapshot();
  const failedEvents = snapshot.events.filter((event) => event.runId === run.id && event.status === "failed");
  assert.ok(failedEvents.some((event) => event.sanitizedMessage.includes("timed out after 500ms")));
});

test("non-retryable provider failure is not retried", async () => {
  await resetEnv("no-retry");
  let attempts = 0;
  const providerId = `hard-fail-${randomUUIDForTest()}`;
  registerProviderAdapter({
    provider: providerId,
    capability: "deployment",
    actions: ["create_project"],
    async execute() {
      attempts += 1;
      throw new ProviderError("invalid credentials", { retryable: false, category: "provider" });
    },
  });
  const project = await createProject({ name: "No Retry", prompt: "Launch no-retry app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: retryPlan(providerId) });
  const run = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "no-retry" });
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "failed");
  assert.equal(attempts, 1);
});

test("sqlite persistence: full mocked deployment completes and survives process-level reset", async () => {
  await resetEnv("sqlite-e2e", "sqlite");
  const project = await createProject({ name: "Sqlite E2E", prompt: "Launch sqlite e2e app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ projectId: project.id, planId: plan.id, idempotencyKey: "sqlite-key" });
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "completed");

  // Simulate process restart: new persistence instance must read the same durable state.
  resetFoundryPersistence();
  const snapshot = await getStoreSnapshot();
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].status, "completed");
  assert.equal(snapshot.events.filter((event) => event.runId === run.id).length > 0, true);
});

test("sqlite persistence is production-safe; file persistence is not", async () => {
  await resetEnv("sqlite-health", "sqlite");
  Object.assign(process.env, { NODE_ENV: "production" });
  const sqliteHealth = await persistenceHealth();
  assert.equal(sqliteHealth.mode, "sqlite");
  assert.equal(sqliteHealth.reachable, true);
  assert.equal(sqliteHealth.productionSafe, true);

  process.env.FOUNDRY_PERSISTENCE = "file";
  resetFoundryPersistence();
  const fileHealth = await persistenceHealth();
  assert.equal(fileHealth.mode, "file");
  assert.equal(fileHealth.productionSafe, false);
  Object.assign(process.env, { NODE_ENV: "test" });
});

test("unknown FOUNDRY_PERSISTENCE mode fails closed", async () => {
  await resetEnv("bad-mode");
  process.env.FOUNDRY_PERSISTENCE = "cosmosdb";
  resetFoundryPersistence();
  const health = await persistenceHealth();
  assert.equal(health.reachable, false);
  assert.equal(health.productionSafe, false);
  assert.match(String(health.probeError), /Unknown FOUNDRY_PERSISTENCE/);
  await assert.rejects(async () => getStoreSnapshot(), /Unknown FOUNDRY_PERSISTENCE/);
});

test("production run creation fails closed on non-production-safe persistence", async () => {
  await resetEnv("prod-gate", "file");
  const project = await createProject({ name: "Prod Gate", prompt: "Launch prod gate app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  Object.assign(process.env, { NODE_ENV: "production" });
  await assert.rejects(
    async () => createRunForProject({ projectId: project.id, planId: plan.id }),
    /durable configured persistence/
  );
  Object.assign(process.env, { NODE_ENV: "test" });
});
