// Proof: a run interrupted before execution (status "queued" in the durable
// store) is resumed and completed by a fresh server process at boot.
//
// Phase "seed": create project/plan/run WITHOUT letting execution finish —
//   we write the run record directly so it stays queued, then exit.
// Phase "verify": after the server booted, poll the run via the API.
//
// Usage (see package.json proof:recovery):
//   node --import tsx scripts/crash-recovery-proof.ts seed
//   <start server>
//   node --import tsx scripts/crash-recovery-proof.ts verify <projectId> <runId>
import { rm } from "fs/promises";

const phase = process.argv[2];

async function seed() {
  process.env.FOUNDRY_PERSISTENCE = "sqlite";
  process.env.FOUNDRY_SQLITE_FILE ||= `${process.cwd()}/.foundry-data/recovery-proof.sqlite`;
  process.env.FOUNDRY_MASTER_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  Object.assign(process.env, { NODE_ENV: "test" });
  await rm(process.env.FOUNDRY_SQLITE_FILE, { force: true });
  await rm(`${process.env.FOUNDRY_SQLITE_FILE}-wal`, { force: true });
  await rm(`${process.env.FOUNDRY_SQLITE_FILE}-shm`, { force: true });

  const { createProject, createPlanForProject, seedMockCredentials } = await import("@/lib/foundry/service");
  const { createRunRecord, insertRecord } = await import("@/lib/foundry/store");

  const project = await createProject({ name: "Recovery Proof", prompt: "Launch recovery proof app on Vercel" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({
    projectId: project.id,
    prompt: project.prompt,
    draftPlan: {
      config: { name: "Recovery Proof", hosting: "vercel", repository: "recovery-proof-repo" },
      budget: { maxSteps: 5, maxRuntimeMs: 120000 },
      steps: [
        {
          id: "github-create",
          provider: "github",
          action: "create_repository",
          name: "Create repo",
          dependsOn: [],
          config: { repositoryName: "recovery-proof-repo" },
          timeoutMs: 15000,
          retryLimit: 1,
          rollbackAction: "create_repository",
        },
        {
          id: "vercel-create",
          provider: "vercel",
          action: "create_project",
          name: "Create Vercel project",
          dependsOn: ["github-create"],
          config: { projectName: "recovery-proof", credentialRef: "secret:vercel/deployment" },
          timeoutMs: 15000,
          retryLimit: 1,
          rollbackAction: "create_project",
        },
        {
          id: "vercel-deploy",
          provider: "vercel",
          action: "trigger_deployment",
          name: "Deploy",
          dependsOn: ["vercel-create"],
          config: { credentialRef: "secret:vercel/deployment" },
          timeoutMs: 15000,
          retryLimit: 1,
        },
      ],
    },
  });
  if (plan.status !== "validated") throw new Error(`plan rejected: ${plan.validationErrors.join(", ")}`);

  // Write the run record directly — simulating a process that crashed after
  // persisting the run but before executing a single step.
  const run = createRunRecord({
    projectId: project.id,
    planId: plan.id,
    status: "queued",
    progress: 0,
    retryCount: 0,
    idempotencyKey: "recovery-proof",
    rollbackStatus: "not_required",
    providerReferences: {},
    evidenceReferences: [],
  });
  await insertRecord("runs", run);
  console.log(JSON.stringify({ projectId: project.id, runId: run.id, seededStatus: run.status }));
}

async function verify() {
  const [, , , projectId, runId] = process.argv;
  const base = process.env.BASE_URL || "http://localhost:3114";
  const token = process.env.FOUNDRY_API_TOKEN || "";
  const deadline = Date.now() + 30000;
  for (;;) {
    const res = await fetch(`${base}/api/projects/${projectId}/runs/${runId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const view = (await res.json()) as { run: { status: string; terminalState?: string } };
      if (["completed", "failed", "cancelled", "rolled_back"].includes(view.run.status)) {
        console.log(JSON.stringify({ recovered: view.run.status === "completed", finalStatus: view.run.status }));
        if (view.run.status !== "completed") process.exit(1);
        return;
      }
    }
    if (Date.now() > deadline) {
      console.error("TIMEOUT: run never reached a terminal state after server boot");
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main() {
  if (phase === "seed") await seed();
  else if (phase === "verify") await verify();
  else {
    console.error("usage: crash-recovery-proof.ts seed|verify <projectId> <runId>");
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
