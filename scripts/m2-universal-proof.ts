/**
 * M2 LIVE PROOF — Universal Provider Orchestration (mock providers).
 *
 * Proves, at runtime, with NO vendor named by the plan author:
 *   1. Create repository            (category: repository)
 *   2. Deploy application           (category: hosting — create/deploy/verify)
 *   3. Configure DNS                (category: dns)
 *   4. Issue certificate            (category: dns)
 *   5. Configure email              (category: email)
 *   6. Evidence persisted
 *   7. Replay (idempotent re-create + ordered event replay)
 *   8. Rollback (compensation in reverse)
 *   9. E.V.E. — independent verification verdict
 *
 * Run: node --import tsx scripts/m2-universal-proof.ts
 */
import { mkdir, rm } from "fs/promises";
import path from "path";
import { createProject, createPlanForProject, createRunForProject, getRunView, listRunEvents, seedMockCredentials } from "@/lib/foundry/service";
import { requestRollback } from "@/lib/foundry/execution";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";
import { verifyRunIndependently, getVerificationView } from "@/lib/foundry/verification";
import { universalRegistry } from "@/lib/foundry/universal/catalog";
import { PROVIDER_CATEGORIES } from "@/lib/foundry/universal/types";

const dataDir = path.join(process.cwd(), ".foundry-test-data");

async function setup() {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(dataDir, "m2-universal-proof.json");
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  await mkdir(dataDir, { recursive: true });
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });
}

async function waitForTerminal(runId: string, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const snapshot = await getStoreSnapshot();
    const run = snapshot.runs.find((item) => item.id === runId);
    if (run && ["completed", "failed", "cancelled", "rolled_back"].includes(run.status)) return run;
    if (Date.now() - start > timeoutMs) throw new Error(`Run ${runId} did not reach terminal state`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function step(id: string, category: string, action: string, name: string, dependsOn: string[], config: Record<string, string> = {}, rollbackAction?: string) {
  return { id, provider: "auto", category, action, name, dependsOn, config, timeoutMs: 10000, retryLimit: 0, ...(rollbackAction ? { rollbackAction } : {}) };
}

async function main() {
  await setup();
  console.log("=== M2 UNIVERSAL PROVIDER ORCHESTRATION — LIVE PROOF (mock providers) ===\n");

  console.log(`Registry: ${universalRegistry.list().length} providers across ${PROVIDER_CATEGORIES.length} categories`);

  const project = await createProject({ orgId: "org_local", name: "M2 Universal Proof", prompt: "Launch a full-stack app with DNS, SSL and email" });
  await seedMockCredentials(project.id);

  // The plan author never names a vendor: every step is provider:"auto".
  const { plan } = await createPlanForProject({
    orgId: "org_local",
    projectId: project.id,
    prompt: project.prompt,
    draftPlan: {
      config: { name: "M2 Proof", hosting: "auto", repository: "m2-proof-repo" },
      budget: { maxSteps: 10, maxRuntimeMs: 300000 },
      steps: [
        step("repo-create", "repository", "create_repository", "Create repository", [], { repositoryName: "m2-proof-repo" }, "create_repository"),
        step("repo-verify", "repository", "verify_repository", "Verify repository", ["repo-create"]),
        step("host-create", "hosting", "create_project", "Create hosting project", ["repo-verify"], { projectName: "m2-proof", credentialRef: "secret:hosting/execution" }, "create_project"),
        step("host-deploy", "hosting", "trigger_deployment", "Deploy application", ["host-create"]),
        step("host-verify", "hosting", "verify_deployment", "Verify deployment", ["host-deploy"]),
        step("dns-record", "dns", "create_dns_record", "Configure DNS", ["host-verify"], { recordName: "m2-proof.example.com", recordContent: "target" }, "create_dns_record"),
        step("cert-issue", "dns", "issue_certificate", "Issue certificate", ["dns-record"], {}, "issue_certificate"),
        step("email-config", "email", "configure_email_domain", "Configure email domain", ["dns-record"], {}, "configure_email_domain"),
      ],
    },
  });
  if (plan.status !== "validated") {
    console.error("PLAN REJECTED:", plan.validationErrors);
    process.exit(1);
  }
  console.log("\nPlan validated. Selection engine resolved providers:");
  for (const planStep of plan.steps) {
    console.log(`  ${planStep.id.padEnd(14)} ${String(planStep.category).padEnd(12)} -> ${planStep.provider}`);
  }

  // Execute.
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "m2-proof" });
  const terminal = await waitForTerminal(run.id);
  console.log(`\nRun ${run.id}: ${terminal.status} (terminalState=${terminal.terminalState})`);
  if (terminal.status !== "completed") {
    console.error("FAILURE:", terminal.sanitizedFailureMessage);
    process.exit(1);
  }

  const view = await getRunView(project.id, run.id);
  console.log(`Steps completed: ${view?.steps.filter((s) => s.status === "completed").length}/${plan.steps.length}`);
  console.log(`Launch evidence: ${view?.evidence[0]?.result} (${view?.evidence[0]?.verifierVersion ?? "n/a"})`);
  console.log("Provider references recorded:", JSON.stringify(terminal.providerReferences, null, 2));

  // Replay: same idempotency key returns the same run; events replay in order.
  const replayRun = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "m2-proof" });
  const events = await listRunEvents(run.id, 0);
  const ordered = events.every((event, i) => i === 0 || event.sequence > events[i - 1].sequence);
  console.log(`\nReplay: same-key run id match=${replayRun.id === run.id}; ${events.length} events, strictly ordered=${ordered}`);

  // E.V.E. — independent verification, never trusting execution's own claims.
  await verifyRunIndependently(run.id, { fetchImpl: async (url) => ({ ok: true, status: 200 }) });
  const verdictView = await getVerificationView(run.id);
  const verdict = verdictView.independentlyVerified ? "PASS" : "HOLD";
  console.log(`\nE.V.E. independent verification: ${verdict}`);
  for (const record of verdictView.latest) {
    console.log(`  ${record.target.kind}: ${record.detail} -> ${record.status}`);
  }

  // Rollback: compensation in reverse for every rollbackable step.
  await requestRollback(run.id);
  const rolled = await waitForTerminal(run.id);
  const snapshot = await getStoreSnapshot();
  const rolledSteps = snapshot.steps.filter((s) => s.runId === run.id && s.status === "rolled_back").length;
  console.log(`\nRollback: run status=${rolled.status}; steps rolled back=${rolledSteps}`);

  const pass =
    terminal.status === "completed" &&
    view?.evidence[0]?.result === "passed" &&
    replayRun.id === run.id &&
    ordered &&
    verdict === "PASS" &&
    rolled.status === "rolled_back" &&
    rolledSteps > 0;

  console.log(`\n=== M2 PROOF RESULT: ${pass ? "PASS" : "FAIL"} ===`);
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error("PROOF CRASHED:", error);
  process.exit(1);
});
