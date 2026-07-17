import assert from "node:assert/strict";
import path from "path";
import { mkdir, rm } from "fs/promises";
import { createPlanForProject, createProject, createRunForProject, seedMockCredentials } from "@/lib/foundry/service";
import { getOperationsReport } from "@/lib/foundry/ops";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";
import { requestRollback } from "@/lib/foundry/execution";
import { registerSecretReference, resetSecretReferences } from "@/lib/vault/registry";
import { requestApproval, resetApprovals } from "@/lib/vault/approvals";
import { resetAuditTrail } from "@/lib/vault/audit";
import { resetHealthState } from "@/lib/foundry/universal/health";
import { resetIntelligence } from "@/lib/foundry/universal/intelligence";

const proofDir = path.join(process.cwd(), ".foundry-test-data");

async function resetProofStore() {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(proofDir, "m4-proof.json");
  process.env.FOUNDRY_SQLITE_FILE = path.join(proofDir, "m4-proof.sqlite");
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  resetSecretReferences();
  resetApprovals();
  resetAuditTrail();
  resetHealthState();
  resetIntelligence();
  await mkdir(proofDir, { recursive: true });
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });
}

async function waitForTerminal(runId: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snapshot = await getStoreSnapshot();
    const run = snapshot.runs.find((item) => item.id === runId);
    if (run && ["completed", "failed", "cancelled", "rolled_back"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Run ${runId} did not reach terminal state`);
}

function draftPlan(repositoryName: string, projectName: string) {
  return {
    config: { name: projectName, hosting: "vercel", repository: repositoryName },
    budget: { maxSteps: 5, maxRuntimeMs: 120000 },
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

async function main() {
  await resetProofStore();

  const alpha = await createProject({ orgId: "org_local", name: "Ops Alpha", prompt: "Launch ops alpha on Vercel" });
  const beta = await createProject({ orgId: "org_local", name: "Ops Beta", prompt: "Launch ops beta on Vercel" });
  await seedMockCredentials(alpha.id, "org_local");
  await seedMockCredentials(beta.id, "org_local");

  const { plan: alphaPlan } = await createPlanForProject({
    orgId: "org_local",
    projectId: alpha.id,
    prompt: alpha.prompt,
    draftPlan: draftPlan("ops-alpha-repo", "ops-alpha"),
  });
  await createPlanForProject({
    orgId: "org_local",
    projectId: beta.id,
    prompt: beta.prompt,
    draftPlan: draftPlan("ops-beta-repo", "ops-beta"),
  });

  const run = await createRunForProject({ orgId: "org_local", projectId: alpha.id, planId: alphaPlan.id, idempotencyKey: "m4-proof-run" });
  const terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "completed");

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
    lastRotatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
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
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  });
  requestApproval({
    requestId: "m4-proof-approval",
    organizationId: "org_local",
    projectId: alpha.id,
    environment: "production",
    machineIdentity: "m4-proof-bot",
    runId: run.id,
    capability: "hosting",
    providerId: "vercel",
    targetResource: "prod-environment",
    intendedAction: "delete_environment",
    secretReferenceIds: [],
    estimatedCostUsd: 20,
    riskLevel: "high",
    requestedDurationMs: 60000,
    requestedAt: new Date().toISOString(),
  });

  await requestRollback(run.id);
  const rolledBack = await waitForTerminal(run.id);
  assert.equal(rolledBack.status, "rolled_back");

  const report = await getOperationsReport("org_local", "m4-proof");
  assert.ok(report.providerHealth.length > 0);
  assert.ok(report.credentials.some((item) => item.rotationRequired));
  assert.ok(report.dependencies.sharedCapabilities.some((item) => item.providerId === "github" && item.projectIds.length === 2));
  assert.ok(report.environmentSync.missingSecrets.some((item) => item.includes("staging")));
  assert.ok(report.approvals.pending >= 1);
  assert.ok(report.rollback.completed >= 1);
  assert.ok(report.incidents.length >= 1);
  assert.ok(report.evidenceLedger.length >= 1);

  const summary = {
    generatedAt: report.generatedAt,
    runtimeScore: report.runtimeHealth.score,
    providers: report.providerHealth.length,
    credentials: report.credentials.length,
    incidents: report.incidents.length,
    sharedProviders: report.dependencies.sharedCapabilities.length,
    pendingApprovals: report.approvals.pending,
    rollbackCompleted: report.rollback.completed,
    evidenceEntries: report.evidenceLedger.length,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
