import { rm } from "fs/promises";
import { createProject, createPlanForProject, createRunForProject, getRunView, seedMockCredentials } from "@/lib/foundry/service";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";
import { getVerificationView, verifyRunIndependently } from "@/lib/foundry/verification";
import { requestRollback } from "@/lib/foundry/execution";

function validDraftPlan() {
  return {
    config: {
      name: "Sprint Proof",
      hosting: "vercel",
      repository: "sprint-proof-repo",
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
        config: { repositoryName: "sprint-proof-repo" },
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
        config: { projectName: "sprint-proof", credentialRef: "secret:vercel-token" },
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

async function main() {
  process.env.FOUNDRY_MASTER_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_STORE_FILE ||= `${process.cwd()}\\.foundry-test-data\\proof-store.json`;
  Object.assign(process.env, { NODE_ENV: "test" });
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });
  resetFoundryPersistence();

  const project = await createProject({ orgId: "org_local", name: "Sprint Proof", prompt: "Launch Sprint Proof using GitHub and Vercel." });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: validDraftPlan() });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "proof-run" });
  const terminal = await waitForTerminal(run.id);
  const view = await getRunView(project.id, run.id);

  // Independent verification slice: stubbed external check (mock URLs are not
  // routable); live verification is credential/DNS-bound, not code-bound.
  await verifyRunIndependently(run.id, { fetchImpl: async () => ({ ok: true, status: 200 }) });
  const verification = await getVerificationView(run.id);

  const rollbackRun = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "rollback-proof-run" });
  await waitForTerminal(rollbackRun.id);
  await requestRollback(rollbackRun.id);
  const rolledBack = await waitForTerminal(rollbackRun.id);

  console.log(
    JSON.stringify(
      {
        projectId: project.id,
        planId: plan.id,
        runId: run.id,
        runStatus: terminal.status,
        evidenceId: view?.evidence[0]?.id ?? null,
        deploymentUrl: view?.run.providerReferences.vercelDeploymentUrl ?? null,
        githubRepoUrl: view?.run.providerReferences.githubRepoUrl ?? null,
        eventCount: (await getStoreSnapshot()).events.filter((event) => event.runId === run.id).length,
        independentlyVerified: verification.independentlyVerified,
        verificationTargets: verification.latest.map((item) => item.target.kind),
        rollbackRunId: rollbackRun.id,
        rollbackStatus: rolledBack.status,
      },
      null,
      2
    )
  );
}

void main();
