import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { mkdir, rm } from "fs/promises";
import { createPlanForProject, createProject, createRunForProject, seedMockCredentials } from "@/lib/foundry/service";
import { getOperationsReport, openManualOperationalIncident } from "@/lib/foundry/ops";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";
import { requestRollback } from "@/lib/foundry/execution";
import { registerSecretReference, resetSecretReferences } from "@/lib/vault/registry";
import { requestApproval, resetApprovals } from "@/lib/vault/approvals";
import { GET as opsRouteGet, POST as opsRoutePost } from "@/app/api/ops/route";
import { resetAuditTrail } from "@/lib/vault/audit";
import { resetHealthState } from "@/lib/foundry/universal/health";
import { resetIntelligence } from "@/lib/foundry/universal/intelligence";

const testDir = path.join(process.cwd(), ".foundry-test-data");
const API_TOKEN = "ops-api-token-123456789";

async function resetEnv(name: string) {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_API_TOKEN = API_TOKEN;
  process.env.FOUNDRY_ORG_ID = "org_local";
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, `${name}.json`);
  process.env.FOUNDRY_SQLITE_FILE = path.join(testDir, `${name}.sqlite`);
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  resetSecretReferences();
  resetApprovals();
  resetAuditTrail();
  resetHealthState();
  resetIntelligence();
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

function validDraftPlan(repositoryName: string, projectName: string) {
  return {
    config: {
      name: projectName,
      hosting: "vercel",
      repository: repositoryName,
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
        config: { repositoryName },
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
        config: { projectName, credentialRef: "secret:vercel/execution" },
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

test("operations report unifies provider, credential, dependency, environment, runtime, and evidence views", async () => {
  await resetEnv("ops-report");

  const alpha = await createProject({ orgId: "org_local", name: "Alpha", prompt: "Launch alpha app on Vercel" });
  const beta = await createProject({ orgId: "org_local", name: "Beta", prompt: "Launch beta app on Vercel" });
  await seedMockCredentials(alpha.id, "org_local");
  await seedMockCredentials(beta.id, "org_local");

  const { plan: alphaPlan } = await createPlanForProject({
    orgId: "org_local",
    projectId: alpha.id,
    prompt: alpha.prompt,
    draftPlan: validDraftPlan("alpha-repo", "alpha-app"),
  });
  const { plan: betaPlan } = await createPlanForProject({
    orgId: "org_local",
    projectId: beta.id,
    prompt: beta.prompt,
    draftPlan: validDraftPlan("beta-repo", "beta-app"),
  });
  const run = await createRunForProject({ orgId: "org_local", projectId: alpha.id, planId: alphaPlan.id, idempotencyKey: "ops-run" });
  await waitForTerminal(run.id);
  await requestRollback(run.id);
  await waitForTerminal(run.id);

  registerSecretReference({
    organizationId: "org_local",
    projectId: alpha.id,
    environment: "development",
    providerId: "vercel",
    category: "hosting",
    displayName: "vercel-token",
    capabilities: ["deploy"],
    requiresApproval: false,
    status: "available",
    lastRotatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  });
  registerSecretReference({
    organizationId: "org_local",
    projectId: alpha.id,
    environment: "production",
    providerId: "vercel",
    category: "hosting",
    displayName: "vercel-token",
    capabilities: ["deploy"],
    requiresApproval: true,
    status: "rotation_due",
    lastRotatedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  requestApproval({
    requestId: "req_ops",
    organizationId: "org_local",
    projectId: alpha.id,
    environment: "production",
    machineIdentity: "ops-bot",
    runId: run.id,
    capability: "hosting",
    providerId: "vercel",
    targetResource: "prod-environment",
    intendedAction: "delete_environment",
    secretReferenceIds: [],
    estimatedCostUsd: 10,
    riskLevel: "high",
    requestedDurationMs: 60000,
    requestedAt: new Date().toISOString(),
  });

  const report = await getOperationsReport("org_local", "tester");
  assert.ok(report.providerHealth.length > 0);
  assert.ok(report.credentials.some((item) => item.source === "vault_reference" && item.rotationRequired));
  assert.ok(report.dependencies.sharedCapabilities.some((item) => item.providerId === "github" && item.projectIds.length === 2));
  assert.ok(report.environmentSync.missingSecrets.some((item) => item.includes("missing in staging")));
  assert.ok(report.approvals.pending >= 1);
  assert.ok(report.rollback.completed >= 1);
  assert.ok(report.runtimeHealth.score >= 0 && report.runtimeHealth.score <= 1);
  assert.ok(report.incidents.some((item) => item.scope === "credential" || item.scope === "environment"));
  assert.ok(report.evidenceLedger.some((item) => item.operation === "provider.health.scan"));
  assert.match(report.dependencies.mermaid, /graph TD/);

  const snapshot = await getStoreSnapshot();
  assert.ok(snapshot.operations.length >= 6);
  assert.ok(snapshot.incidents.length >= 1);
  assert.equal(betaPlan.status, "validated");
});

test("operations API returns a protected report and supports incident open/resolve workflows", async () => {
  await resetEnv("ops-route");

  const project = await createProject({ orgId: "org_local", name: "Ops Route", prompt: "Launch ops route app on Vercel" });
  const seededIncident = await openManualOperationalIncident({
    actor: "tester",
    scope: "service",
    severity: "medium",
    summary: "Control plane drift detected",
    projectIds: [project.id],
    impact: "Runtime verification is stale",
    recommendedActions: ["Re-run runtime verification"],
    rollbackPlan: ["Pause promotions until verification passes"],
  });

  const getResponse = await opsRouteGet(
    new Request("http://localhost/api/ops", { headers: { Authorization: `Bearer ${API_TOKEN}` } }) as any
  );
  assert.equal(getResponse.status, 200);
  const report = await getResponse.json();
  assert.equal(report.organizationId, "org_local");
  assert.ok(Array.isArray(report.providerHealth));

  const openResponse = await opsRoutePost(
    new Request("http://localhost/api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify({
        action: "incident.open",
        scope: "provider",
        severity: "high",
        summary: "Provider outage detected",
        providerId: "github",
        impact: "Repository provisioning is blocked",
        recommendedActions: ["Fail over to local-git"],
        rollbackPlan: ["Pause new repository creates"],
      }),
    }) as any
  );
  assert.equal(openResponse.status, 201);
  const opened = await openResponse.json();
  assert.equal(opened.summary, "Provider outage detected");

  const resolveResponse = await opsRoutePost(
    new Request("http://localhost/api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify({
        action: "incident.resolve",
        incidentId: seededIncident.id,
        resolutionEvidence: "Runtime verification rerun passed",
      }),
    }) as any
  );
  assert.equal(resolveResponse.status, 200);

  const snapshot = await getStoreSnapshot();
  const resolved = snapshot.incidents.find((item) => item.id === seededIncident.id);
  assert.equal(resolved?.status, "resolved");
});
