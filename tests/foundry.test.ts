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
import { POST as cancelRoute } from "@/app/api/projects/[id]/runs/[runId]/cancel/route";
import { GET as runViewRoute } from "@/app/api/projects/[id]/runs/[runId]/route";
import { GET as runLogsRoute } from "@/app/api/projects/[id]/runs/[runId]/logs/route";
import { POST as verifyRoutePost } from "@/app/api/projects/[id]/runs/[runId]/verify/route";
import { getVerificationView, verifyRunIndependently } from "@/lib/foundry/verification";
import { GET as healthzRoute } from "@/app/api/healthz/route";
import { getProviderAdapter, listRegisteredProviders, registerProviderAdapter, ProviderError, VercelHttpAdapter, GitHubHttpAdapter, CloudflareDnsAdapter, ResendEmailAdapter, StripePaymentsAdapter, SignalWireTelephonyAdapter, listProviderMetadata, type ProviderAdapter } from "@/lib/foundry/providers";
import { CloudflareAdapter as CloudflareClient, ResendAdapter as ResendClient, StripeAdapter as StripeClient, SignalWireAdapter as SignalWireClient } from "@/lib/providers/domains.adapter";
import { VercelAdapter as VercelClient } from "@/lib/providers/vercel.adapter";
import { GitHubAdapter as GitHubClient } from "@/lib/providers/github.adapter";
import { ProviderError as HttpProviderError } from "@/lib/providers/http-client";
import { ProviderRegistry, UnknownProviderError, DuplicateProviderError } from "@/lib/foundry/registry";

const testDir = path.join(process.cwd(), ".foundry-test-data");

async function resetEnv(name: string, mode: "file" | "sqlite" = "file") {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  delete process.env.FOUNDRY_API_TOKEN;
  delete process.env.FOUNDRY_PRINCIPALS;
  delete process.env.FOUNDRY_ORG_ID;
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
  const project = await createProject({ orgId: "org_local", name: "Invalid Plan", prompt: "Launch invalid plan app" });
  const { plan } = await createPlanForProject({
    orgId: "org_local",
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
  const project = await createProject({ orgId: "org_local", name: "Happy Path", prompt: "Launch happy path app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  assert.equal(plan.status, "validated");
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "happy-key" });
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
  const project = await createProject({ orgId: "org_local", name: "Replay", prompt: "Launch replay app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "same-key" });
  const run2 = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "same-key" });
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
  const project = await createProject({ orgId: "org_local", name: "Rollback", prompt: "Launch rollback app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "rollback-key" });
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
  const project = await createProject({ orgId: "org_local", name: "Resume", prompt: "Launch resume app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "resume-key" });
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

function stubHttp(handler: (url: string, options: RequestInit) => unknown) {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  return {
    calls,
    client: {
      async request(url: string, options: RequestInit = {}) {
        calls.push({ url, options });
        return handler(url, options);
      },
    } as unknown as import("@/lib/providers/http-client").ProviderHTTPClient,
  };
}

test("live Vercel adapter triggers a git deployment and normalizes the result", async () => {
  const { calls, client } = stubHttp((url) => {
    if (url.endsWith("/v13/deployments")) {
      return { id: "dpl_123", url: "myapp-abc.vercel.app", readyState: "QUEUED" };
    }
    throw new Error(`unexpected url ${url}`);
  });
  const adapter = new VercelHttpAdapter("fake-token", new VercelClient("fake-token", client));
  const result = await adapter.execute("trigger_deployment", {
    runId: "run1",
    stepId: "step1",
    projectId: "proj1",
    config: { projectName: "myapp" },
    providerReferences: { githubRepoUrl: "https://github.com/acme/myapp" },
  });
  assert.equal(result.providerReference, "dpl_123");
  assert.equal(result.output.deploymentUrl, "https://myapp-abc.vercel.app");
  assert.equal(result.output.deploymentId, "dpl_123");
  const body = JSON.parse(String(calls[0].options.body));
  assert.deepEqual(body.gitSource, { type: "github", org: "acme", repo: "myapp", ref: "main" });
});

test("live Vercel adapter verifies a deployment via polling and fails on ERROR state", async () => {
  let polls = 0;
  const { client } = stubHttp((url) => {
    if (url.includes("/v13/deployments/dpl_ok")) {
      polls += 1;
      return { id: "dpl_ok", url: "ok.vercel.app", readyState: polls < 2 ? "BUILDING" : "READY" };
    }
    if (url.includes("/v13/deployments/dpl_bad")) {
      return { id: "dpl_bad", url: "bad.vercel.app", readyState: "ERROR" };
    }
    throw new Error(`unexpected url ${url}`);
  });
  const vercel = new VercelClient("fake-token", client);
  const ready = await vercel.waitForDeployment("dpl_ok", 10);
  assert.equal(ready.readyState, "READY");
  assert.equal(polls, 2);
  await assert.rejects(async () => vercel.waitForDeployment("dpl_bad", 10), /ended in state ERROR/);
});

test("live Vercel adapter compensates trigger_deployment by cancelling the deployment", async () => {
  const { calls, client } = stubHttp(() => ({ id: "dpl_123", url: "x.vercel.app", readyState: "CANCELED" }));
  const adapter = new VercelHttpAdapter("fake-token", new VercelClient("fake-token", client));
  await adapter.compensate("trigger_deployment", {
    runId: "run1",
    stepId: "step1",
    projectId: "proj1",
    config: {},
    providerReferences: {},
    providerReference: "dpl_123",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v12\/deployments\/dpl_123\/cancel$/);
  assert.equal(calls[0].options.method, "PATCH");
});

test("live GitHub adapter creates a repository and verifies it by read-back before reporting success", async () => {
  const { calls, client } = stubHttp((url, options) => {
    if (url.endsWith("/user/repos") && options.method === "POST") {
      return { id: 42, full_name: "acme/new-repo", html_url: "https://github.com/acme/new-repo", default_branch: "main", private: true };
    }
    if (url.endsWith("/repos/acme/new-repo") && options.method === "GET") {
      return { id: 42, full_name: "acme/new-repo", html_url: "https://github.com/acme/new-repo", default_branch: "main", private: true };
    }
    throw new Error(`unexpected url ${url}`);
  });
  const adapter = new GitHubHttpAdapter("fake-token", new GitHubClient("fake-token", client));
  const result = await adapter.execute("create_repository", {
    runId: "run1",
    stepId: "step1",
    projectId: "proj1",
    config: { repositoryName: "new-repo" },
    providerReferences: {},
  });
  assert.equal(calls.length, 2); // create + independent read-back
  assert.equal(result.providerReference, "acme/new-repo");
  assert.equal(result.output.repoUrl, "https://github.com/acme/new-repo");
  assert.equal(result.output.defaultBranch, "main");
  assert.equal(result.evidenceReference, "github:acme/new-repo#42");
});

test("live GitHub adapter rejects unsafe repository names and owners", async () => {
  const { client } = stubHttp(() => ({}));
  const adapter = new GitHubHttpAdapter("fake-token", new GitHubClient("fake-token", client));
  await assert.rejects(
    async () =>
      adapter.execute("create_repository", {
        runId: "r",
        stepId: "s",
        projectId: "p",
        config: { repositoryName: "../../etc/passwd" },
        providerReferences: {},
      }),
    /unsafe repository name/
  );
  await assert.rejects(async () => new GitHubClient("t", client).getRepository("a/b", "ok"), /unsafe repository owner/);
});

test("live GitHub adapter normalizes HTTP failures into classified provider errors", async () => {
  const { client } = stubHttp(() => {
    throw new HttpProviderError("Provider API error: 503", 503, {});
  });
  const adapter = new GitHubHttpAdapter("fake-token", new GitHubClient("fake-token", client));
  const attempt = adapter.execute("verify_repository", {
    runId: "r",
    stepId: "s",
    projectId: "p",
    config: { repositoryFullName: "acme/app" },
    providerReferences: {},
  });
  await assert.rejects(attempt, (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.retryable, true);
    assert.match(error.message, /github API error \(503\)/);
    return true;
  });

  const { client: notFound } = stubHttp(() => {
    throw new HttpProviderError("Provider API error: 404", 404, {});
  });
  const adapter404 = new GitHubHttpAdapter("fake-token", new GitHubClient("fake-token", notFound));
  await assert.rejects(
    adapter404.execute("verify_repository", {
      runId: "r",
      stepId: "s",
      projectId: "p",
      config: { repositoryFullName: "acme/missing" },
      providerReferences: {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.retryable, false);
      return true;
    }
  );
});

test("live GitHub adapter compensates create_repository by deleting exactly the created repo", async () => {
  const { calls, client } = stubHttp(() => undefined);
  const adapter = new GitHubHttpAdapter("fake-token", new GitHubClient("fake-token", client));
  await adapter.compensate("create_repository", {
    runId: "r",
    stepId: "s",
    projectId: "p",
    config: {},
    providerReferences: {},
    providerReference: "acme/new-repo",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/repos\/acme\/new-repo$/);
  assert.equal(calls[0].options.method, "DELETE");
});

test("mock providers fail closed in production instead of fabricating results", async () => {
  await resetEnv("mock-prod-guard");
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    const github = getProviderAdapter("github");
    await assert.rejects(
      github.execute("create_repository", {
        runId: "r",
        stepId: "s",
        projectId: "p",
        config: { repositoryName: "x" },
        providerReferences: {},
      }),
      /mock github provider is disabled in production/
    );
  } finally {
    Object.assign(process.env, { NODE_ENV: "test" });
  }
});

test("cancellation during an active run stops execution before the next step", async () => {
  await resetEnv("cancel-active");
  const providerId = `slow-provider-${randomUUIDForTest()}`;
  let flakyStepStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    flakyStepStarted = resolve;
  });
  registerProviderAdapter({
    provider: providerId,
    capability: "deployment",
    actions: ["create_project"],
    async execute() {
      flakyStepStarted?.();
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { providerReference: "slow-ref", output: { projectId: "slow-project" } };
    },
  });
  const project = await createProject({ orgId: "org_local", name: "Cancel", prompt: "Launch cancel app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({
    orgId: "org_local",
    projectId: project.id,
    prompt: project.prompt,
    // Slow step first: cancellation is honored before the NEXT step starts.
    draftPlan: {
      config: { name: "Cancel App", hosting: "vercel", repository: "cancel-repo" },
      budget: { maxSteps: 5, maxRuntimeMs: 120000 },
      steps: [
        {
          id: "slow-step",
          provider: providerId,
          action: "create_project",
          name: "Slow provider step",
          dependsOn: [],
          config: { projectName: "cancel-app", credentialRef: "secret:vercel/deployment" },
          timeoutMs: 5000,
          retryLimit: 0,
        },
        {
          id: "github-create",
          provider: "github",
          action: "create_repository",
          name: "Create repo",
          dependsOn: ["slow-step"],
          config: { repositoryName: "cancel-repo" },
          timeoutMs: 15000,
          retryLimit: 0,
        },
      ],
    },
  });
  assert.equal(plan.status, "validated");
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "cancel-key" });

  await started; // the slow step is now executing
  const res = await cancelRoute(
    new Request(`http://localhost/api/projects/${project.id}/runs/${run.id}/cancel`, { method: "POST" }) as any,
    { params: { id: project.id, runId: run.id } }
  );
  assert.equal(res.status, 202);

  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "cancelled");
  assert.equal(terminal.failureCategory, "cancelled");
  assert.equal(terminal.terminalState, "cancelled");
});

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

const ORG_A_TOKEN = "org-a-token-0123456789abcdef";
const ORG_B_TOKEN = "org-b-token-0123456789abcdef";

function setTwoOrgPrincipals() {
  process.env.FOUNDRY_PRINCIPALS = JSON.stringify([
    { token: ORG_A_TOKEN, id: "svc-a", orgId: "org_a", role: "admin" },
    { token: ORG_B_TOKEN, id: "svc-b", orgId: "org_b", role: "admin" },
  ]);
}

test("cross-tenant isolation: another org cannot view, cancel, or enumerate a run", async () => {
  await resetEnv("tenancy");
  setTwoOrgPrincipals();

  // Org A creates a project and completes a run.
  const project = await createProject({ orgId: "org_a", name: "Tenant A App", prompt: "Launch tenant A app on Vercel", requestedBy: "svc-a" });
  await seedMockCredentials(project.id, "org_a");
  const { plan } = await createPlanForProject({ orgId: "org_a", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_a", projectId: project.id, planId: plan.id, idempotencyKey: "tenant-a", requestedBy: "svc-a" });
  await waitForTerminal(run.id);

  // Audit actor persisted on the run.
  const snapshot = await getStoreSnapshot();
  assert.equal(snapshot.runs.find((item) => item.id === run.id)?.requestedBy, "svc-a");

  // Org B sees 404 (not 403 — no enumeration signal) on the run view.
  const viewB = await runViewRoute(
    new Request(`http://localhost/api/projects/${project.id}/runs/${run.id}`, {
      headers: { Authorization: `Bearer ${ORG_B_TOKEN}` },
    }) as any,
    { params: { id: project.id, runId: run.id } }
  );
  assert.equal(viewB.status, 404);

  // Org B cannot cancel org A's run.
  const cancelB = await cancelRoute(
    new Request(`http://localhost/api/projects/${project.id}/runs/${run.id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ORG_B_TOKEN}` },
    }) as any,
    { params: { id: project.id, runId: run.id } }
  );
  assert.equal(cancelB.status, 404);

  // Org B cannot subscribe to org A's event stream.
  const logsB = await runLogsRoute(
    new Request(`http://localhost/api/projects/${project.id}/runs/${run.id}/logs`, {
      headers: { Authorization: `Bearer ${ORG_B_TOKEN}` },
    }) as any,
    { params: { id: project.id, runId: run.id } }
  );
  assert.equal(logsB.status, 404);

  // Org A still has full access.
  const viewA = await runViewRoute(
    new Request(`http://localhost/api/projects/${project.id}/runs/${run.id}`, {
      headers: { Authorization: `Bearer ${ORG_A_TOKEN}` },
    }) as any,
    { params: { id: project.id, runId: run.id } }
  );
  assert.equal(viewA.status, 200);
});

test("service-layer scope: listRunEvents and plan creation reject cross-org access", async () => {
  await resetEnv("tenancy-service");
  const project = await createProject({ orgId: "org_a", name: "Scope App", prompt: "Launch scope app on Vercel" });
  await seedMockCredentials(project.id, "org_a");
  const { plan } = await createPlanForProject({ orgId: "org_a", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_a", projectId: project.id, planId: plan.id, idempotencyKey: "scope-key" });
  await waitForTerminal(run.id);

  await assert.rejects(async () => listRunEvents(run.id, 0, "org_b"), /not found/);
  await assert.rejects(
    async () => createPlanForProject({ orgId: "org_b", projectId: project.id, prompt: "steal", draftPlan: validDraftPlan() }),
    /not found/
  );
  await assert.rejects(
    async () => createRunForProject({ orgId: "org_b", projectId: project.id, planId: plan.id }),
    /not found/
  );
  await assert.rejects(async () => seedMockCredentials(project.id, "org_b"), /not found/);
  const events = await listRunEvents(run.id, 0, "org_a");
  assert.ok(events.length > 0);
});

test("malformed FOUNDRY_PRINCIPALS fails closed: nobody authenticates", async () => {
  await resetEnv("bad-principals");
  process.env.FOUNDRY_PRINCIPALS = "{not json";
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    const res = await createProjectRoute(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ORG_A_TOKEN}` },
        body: JSON.stringify({ name: "X", prompt: "Launch x app on Vercel now" }),
      }) as any
    );
    assert.equal(res.status, 503);
  } finally {
    Object.assign(process.env, { NODE_ENV: "test" });
  }
});

test("independent verification is separate from run status and retryable without altering history", async () => {
  await resetEnv("verify-independent", "sqlite");
  const project = await createProject({ orgId: "org_local", name: "Verify App", prompt: "Launch verify app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "verify-key" });
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "completed");

  const before = await getStoreSnapshot();
  const runsBefore = JSON.stringify(before.runs);
  const eventsBefore = JSON.stringify(before.events);

  // Attempt 1: the outside world says the deployment is NOT reachable.
  await verifyRunIndependently(run.id, { fetchImpl: async () => ({ ok: false, status: 503 }) });
  let view = await getVerificationView(run.id);
  assert.equal(view.independentlyVerified, false);
  assert.ok(view.latest.every((item) => item.status === "failed"));

  // Adapter success + verification failure must NOT read as fully verified,
  // and the verifier must not have altered execution history.
  const after = await getStoreSnapshot();
  assert.equal(after.runs.find((item) => item.id === run.id)?.status, "completed");
  assert.equal(JSON.stringify(after.runs), runsBefore);
  assert.equal(JSON.stringify(after.events), eventsBefore);

  // Attempt 2: independent retry passes; history keeps both attempts.
  await verifyRunIndependently(run.id, { fetchImpl: async () => ({ ok: true, status: 200 }) });
  view = await getVerificationView(run.id);
  assert.equal(view.independentlyVerified, true);
  assert.equal(Math.max(...view.records.map((item) => item.attempt)), 2);
  assert.ok(view.records.length > view.latest.length);
  assert.ok(view.records.every((item) => typeof item.checkedAt === "string" && item.checkedAt.length > 0));

  // Verification evidence survives a process-level persistence reset.
  resetFoundryPersistence();
  const persisted = await getVerificationView(run.id);
  assert.equal(persisted.independentlyVerified, true);
  assert.equal(persisted.records.length, view.records.length);
});

test("verification route enforces org scope", async () => {
  await resetEnv("verify-scope");
  setTwoOrgPrincipals();
  const project = await createProject({ orgId: "org_a", name: "Verify Scope", prompt: "Launch verify scope app on Vercel" });
  await seedMockCredentials(project.id, "org_a");
  const { plan } = await createPlanForProject({ orgId: "org_a", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_a", projectId: project.id, planId: plan.id, idempotencyKey: "verify-scope" });
  await waitForTerminal(run.id);

  const crossOrg = await verifyRoutePost(
    new Request(`http://localhost/api/projects/${project.id}/runs/${run.id}/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ORG_B_TOKEN}` },
    }) as any,
    { params: { id: project.id, runId: run.id } }
  );
  assert.equal(crossOrg.status, 404);
});

test("Cloudflare DNS adapter creates a record with read-back and compensates by deletion", async () => {
  const records = new Map<string, { id: string; type: string; name: string; content: string }>();
  const { calls, client } = stubHttp((url, options) => {
    if (options.method === "POST" && url.endsWith("/zones/zone1/dns_records")) {
      const body = JSON.parse(String(options.body));
      const record = { id: "rec1", type: body.type, name: body.name, content: body.content };
      records.set("rec1", record);
      return { result: record };
    }
    if (options.method === "GET" && url.endsWith("/zones/zone1/dns_records/rec1")) {
      const record = records.get("rec1");
      if (!record) throw new HttpProviderError("not found", 404, {});
      return { result: record };
    }
    if (options.method === "DELETE" && url.endsWith("/zones/zone1/dns_records/rec1")) {
      records.delete("rec1");
      return { result: { id: "rec1" } };
    }
    throw new Error(`unexpected ${options.method} ${url}`);
  });
  const adapter = new CloudflareDnsAdapter("fake-token", new CloudflareClient("fake-token", client));
  const created = await adapter.execute("create_dns_record", {
    runId: "r",
    stepId: "s",
    projectId: "p",
    config: { zoneId: "zone1", recordType: "CNAME", recordName: "app.example.com", recordContent: "cname.vercel-dns.com" },
    providerReferences: {},
  });
  assert.equal(created.providerReference, "zone1/rec1");
  assert.equal(created.output.name, "app.example.com");
  assert.equal(calls.length, 2); // create + read-back

  await adapter.compensate?.("create_dns_record", {
    runId: "r",
    stepId: "s",
    projectId: "p",
    config: {},
    providerReferences: {},
    providerReference: "zone1/rec1",
  });
  assert.equal(records.has("rec1"), false);
  await assert.rejects(
    adapter.execute("verify_dns_record", {
      runId: "r",
      stepId: "s",
      projectId: "p",
      config: { recordReference: "zone1/rec1" },
      providerReferences: {},
    }),
    /cloudflare API error \(404\)/
  );
});

test("Resend and SignalWire adapters send with correct request shape and declare no rollback", async () => {
  const { calls, client } = stubHttp((url) => {
    if (url.endsWith("/emails")) return { id: "email_1" };
    if (url.includes("/Messages.json")) return { sid: "sms_1", status: "queued" };
    throw new Error(`unexpected url ${url}`);
  });
  const email = new ResendEmailAdapter("fake-key", new ResendClient("fake-key", client));
  const sent = await email.execute("send_email", {
    runId: "r",
    stepId: "s",
    projectId: "p",
    config: { emailFrom: "ops@foundry.dev", emailTo: "owner@example.com", emailSubject: "Launched", emailBody: "done" },
    providerReferences: {},
  });
  assert.equal(sent.providerReference, "email_1");
  assert.equal("compensate" in email, false); // email cannot be unsent

  const sms = new SignalWireTelephonyAdapter("space.signalwire.com", "proj1", "fake-token", new SignalWireClient("space.signalwire.com", "proj1", "fake-token", client));
  const result = await sms.execute("send_sms", {
    runId: "r",
    stepId: "s",
    projectId: "p",
    config: { smsFrom: "+15550001111", smsTo: "+15550002222", smsBody: "launch complete" },
    providerReferences: {},
  });
  assert.equal(result.providerReference, "sms_1");
  assert.equal("compensate" in sms, false); // SMS cannot be recalled
  assert.equal(calls.length, 2);
  const smsCall = calls[1];
  assert.match(String(smsCall.options.body), /From=%2B15550001111/);
});

test("Stripe adapter creates + verifies a product and compensates by archiving", async () => {
  let active = true;
  const { calls, client } = stubHttp((url, options) => {
    if (options.method === "POST" && url.endsWith("/products")) return { id: "prod_1", name: "DYLN Plan", active: true };
    if (options.method === "GET" && url.endsWith("/products/prod_1")) return { id: "prod_1", name: "DYLN Plan", active };
    if (options.method === "POST" && url.endsWith("/products/prod_1")) {
      active = false;
      return { id: "prod_1", active };
    }
    throw new Error(`unexpected ${options.method} ${url}`);
  });
  const adapter = new StripePaymentsAdapter("sk_test_fake", new StripeClient("sk_test_fake", client));
  const created = await adapter.execute("create_product", {
    runId: "r",
    stepId: "s",
    projectId: "p",
    config: { productName: "DYLN Plan" },
    providerReferences: {},
  });
  assert.equal(created.providerReference, "prod_1");
  assert.equal(calls[0].options.headers && true, true);
  await adapter.compensate?.("create_product", {
    runId: "r",
    stepId: "s",
    projectId: "p",
    config: {},
    providerReferences: {},
    providerReference: "prod_1",
  });
  assert.equal(active, false);
});

test("all capability domains are registered with declared actions and truthful mock flags", async () => {
  await resetEnv("cap-metadata");
  const metadata = listProviderMetadata();
  for (const capability of ["repository", "deployment", "dns", "email", "payments", "telephony", "storage"]) {
    assert.ok(Array.isArray(metadata[capability]) && metadata[capability].length > 0, `missing capability ${capability}`);
    for (const entry of metadata[capability]) {
      assert.ok(entry.actions.length > 0, `${entry.provider} declares no actions`);
    }
  }
  // Without credentials configured, domain providers are truthfully marked mock.
  assert.equal(metadata.dns.find((item) => item.provider === "cloudflare")?.mock, true);
  // Plans requesting an undeclared action are rejected by registry validation.
  const project = await createProject({ orgId: "org_local", name: "Cap Test", prompt: "Launch cap test app on Vercel" });
  const { plan } = await createPlanForProject({
    orgId: "org_local",
    projectId: project.id,
    prompt: project.prompt,
    draftPlan: {
      config: { name: "Cap", hosting: "vercel", repository: "cap-repo" },
      budget: { maxSteps: 5, maxRuntimeMs: 120000 },
      steps: [
        {
          id: "bad-action",
          provider: "cloudflare",
          action: "purchase_domain",
          name: "Unsupported op",
          dependsOn: [],
          config: {},
          timeoutMs: 5000,
          retryLimit: 0,
        },
      ],
    },
  });
  assert.equal(plan.status, "rejected");
  assert.ok(plan.validationErrors.some((error) => error.includes("unsupported action purchase_domain")));
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
  const project = await createProject({ orgId: "org_local", name: "Retry Success", prompt: "Launch retry app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: retryPlan(providerId) });
  assert.equal(plan.status, "validated");
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "retry-ok" });
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
  const project = await createProject({ orgId: "org_local", name: "Timeout", prompt: "Launch timeout app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: retryPlan(providerId) });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "retry-timeout" });
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
  const project = await createProject({ orgId: "org_local", name: "No Retry", prompt: "Launch no-retry app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: retryPlan(providerId) });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "no-retry" });
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "failed");
  assert.equal(attempts, 1);
});

test("sqlite persistence: full mocked deployment completes and survives process-level reset", async () => {
  await resetEnv("sqlite-e2e", "sqlite");
  const project = await createProject({ orgId: "org_local", name: "Sqlite E2E", prompt: "Launch sqlite e2e app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "sqlite-key" });
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
  const project = await createProject({ orgId: "org_local", name: "Prod Gate", prompt: "Launch prod gate app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  Object.assign(process.env, { NODE_ENV: "production" });
  await assert.rejects(
    async () => createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id }),
    /durable configured persistence/
  );
  Object.assign(process.env, { NODE_ENV: "test" });
});
