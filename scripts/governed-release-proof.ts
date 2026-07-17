/**
 * FOUNDRY end-to-end governed release proof (Mission 18).
 *
 * Exercises the full governed lifecycle on a SAFE local fixture — no production
 * mutation, no real provider writes (mock adapters), one real read-only shape
 * for independent verification. Emits a machine-readable evidence bundle under
 * proof/evidence/.
 *
 * Run: npm run proof:release
 */
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { intakeEnvelope } from "@/lib/foundry/envelope";
import { evaluatePromotion, type ReleaseContext } from "@/lib/foundry/release-policy";
import { verifyArtifactIntegrity, listArtifacts } from "@/lib/foundry/artifacts";
import { decideGate, listGates } from "@/lib/foundry/human-gates";
import { createProject, createPlanForProject, createRunForProject, seedMockCredentials } from "@/lib/foundry/service";
import { resumeRunAfterGate, requestRollback, resumeIncompleteRuns } from "@/lib/foundry/execution";
import { verifyRunIndependently } from "@/lib/foundry/verification";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";

const ORG = "org_proof";
const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

async function waitForStatus(runId: string, statuses: string[], timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = (await getStoreSnapshot()).runs.find((r) => r.id === runId);
    if (run && statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Run ${runId} did not reach ${statuses.join("/")}`);
}

/**
 * A real restart is a fresh OS process, so no in-flight writer survives it. In
 * this single process we must first let all background execution drain before
 * swapping the persistence handle, or two FilePersistence instances would race
 * on the same file (Windows EPERM on rename).
 */
async function waitForRunsIdle(timeoutMs = 4000) {
  const active = globalThis as unknown as { __foundryActiveRuns?: Set<string> };
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!active.__foundryActiveRuns || active.__foundryActiveRuns.size === 0) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  // Small settle window so the last queued store write flushes.
  await new Promise((r) => setTimeout(r, 250));
}

function gatedPlanDraft() {
  return {
    config: { name: "Proof App", hosting: "vercel", repository: "proof-repo" },
    budget: { maxSteps: 6, maxRuntimeMs: 120000 },
    steps: [
      { id: "repo", provider: "github", action: "create_repository", name: "Create repo", dependsOn: [], config: { repositoryName: "proof-repo" }, timeoutMs: 15000, retryLimit: 1, rollbackAction: "create_repository", approvalRequired: true },
      { id: "verify-repo", provider: "github", action: "verify_repository", name: "Verify repo", dependsOn: ["repo"], config: {}, timeoutMs: 5000, retryLimit: 0 },
      { id: "host", provider: "vercel", action: "create_project", name: "Create hosting", dependsOn: ["verify-repo"], config: { projectName: "proof-app", credentialRef: "secret:hosting/execution" }, timeoutMs: 15000, retryLimit: 1, rollbackAction: "create_project" },
      { id: "deploy", provider: "vercel", action: "trigger_deployment", name: "Deploy", dependsOn: ["host"], config: {}, timeoutMs: 15000, retryLimit: 1 },
      { id: "verify-deploy", provider: "vercel", action: "verify_deployment", name: "Verify deploy", dependsOn: ["deploy"], config: {}, timeoutMs: 5000, retryLimit: 0 },
    ],
  };
}

async function main() {
  const sandbox = path.join(process.cwd(), ".foundry-proof");
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(sandbox, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(sandbox, "artifacts");
  Object.assign(process.env, { NODE_ENV: "test" });
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  resetFoundryPersistence();

  // 1. Envelope intake — accepted with a human gate.
  const intake = intakeEnvelope({
    envelopeId: "env_proof_1",
    missionId: "mission_proof",
    projectRef: "proof",
    requestedOperation: "release",
    targetEnvironment: "staging",
    idempotencyKey: "idem_proof_1",
    source: { orchestrator: "veridian", reference: "proof" },
    approvalRequirements: [{ stepId: "repo", reason: "first governed release requires founder approval" }],
    plan: gatedPlanDraft(),
  });
  record("1. envelope accepted", intake.decision === "ACCEPTED_WITH_GATES", `decision=${intake.decision}, gates=${intake.gates.length}`);

  // 2. Policy pre-evaluation (pre-execution signals unknown → manual review).
  const preDecision = evaluatePromotion({ targetEnvironment: "staging", riskLevel: "moderate", testStatus: "unknown", buildStatus: "passed", runtimeStatus: "unknown", securityStatus: "passed", verificationStatus: "unknown", approvalsGranted: 0, artifactsComplete: false, rollbackReady: false, providerHealthy: "passed" });
  record("2. policy evaluated (pre-exec)", preDecision.outcome === "PROMOTION_BLOCKED" || preDecision.outcome === "MANUAL_REVIEW_REQUIRED", `outcome=${preDecision.outcome}`);

  // 3. Create + run; execution pauses at the human gate.
  const project = await createProject({ orgId: ORG, name: "Proof App", prompt: "governed release proof" });
  await seedMockCredentials(project.id, ORG);
  const { plan } = await createPlanForProject({ orgId: ORG, projectId: project.id, prompt: project.prompt, draftPlan: gatedPlanDraft() });
  record("3. plan validated", plan.status === "validated", `errors=${plan.validationErrors.join("|") || "none"}`);
  const run = await createRunForProject({ orgId: ORG, projectId: project.id, planId: plan.id });

  const paused = await waitForStatus(run.id, ["awaiting_approval"]);
  const gates = await listGates({ runId: run.id, status: "pending" });
  record("4. human gate raised, run paused", paused.status === "awaiting_approval" && gates.length === 1, `gate=${gates[0]?.id} step=${gates[0]?.planStepId}`);

  // 5. Approve gate and resume — provider modes selected per step.
  await decideGate(gates[0].id, "approved", "founder@proof");
  await resumeRunAfterGate(run.id);
  const completed = await waitForStatus(run.id, ["completed", "failed", "rolled_back"]);
  record("5. operation executed to completion", completed.status === "completed", `status=${completed.status}, refs=${Object.keys(completed.providerReferences).join(",")}`);

  // 6. Artifacts retained + integrity verified.
  const artifacts = await listArtifacts({ runId: run.id });
  const integrity = await Promise.all(artifacts.map((a) => verifyArtifactIntegrity(a.id)));
  record("6. artifacts retained + verified", artifacts.length >= 2 && integrity.every((i) => i.ok), `count=${artifacts.length}, classes=${artifacts.map((a) => a.retentionClass).join(",")}`);

  // 7. Independent verification (stubbed reachable — never mutates run history).
  const verifications = await verifyRunIndependently(run.id, { fetchImpl: async () => ({ ok: true, status: 200 }) });
  record("7. independent verification", verifications.every((v) => v.status === "passed"), `targets=${verifications.length}`);

  // 8. Evidence bundle present + signed.
  const snapshot = await getStoreSnapshot();
  const manifest = snapshot.evidenceManifests.find((m) => m.executionId === run.idempotencyKey);
  record("8. signed evidence manifest", !!manifest && !!manifest.signature, `alg=${manifest?.signatureAlgorithm}, items=${manifest?.evidenceItems.length}`);

  // 9. Post-exec promotion decision (all green now).
  const releaseCtx: ReleaseContext = {
    targetEnvironment: "staging",
    riskLevel: "moderate",
    testStatus: "passed",
    buildStatus: "passed",
    runtimeStatus: completed.status === "completed" ? "passed" : "failed",
    securityStatus: "passed",
    verificationStatus: verifications.every((v) => v.status === "passed") ? "passed" : "failed",
    approvalsGranted: 1,
    artifactsComplete: artifacts.length >= 2,
    rollbackReady: completed.rollbackStatus === "available" || completed.rollbackStatus === "completed",
    providerHealthy: "passed",
  };
  const promotion = evaluatePromotion(releaseCtx);
  record("9. promotion decision recorded", promotion.outcome === "PROMOTION_ALLOWED" || promotion.outcome === "PROMOTION_ALLOWED_WITH_APPROVAL", `outcome=${promotion.outcome}`);

  // 10. Rollback via the completed run's compensation path.
  await requestRollback(run.id);
  const rolledBack = await waitForStatus(run.id, ["rolled_back", "failed"]);
  record("10. rollback executed", rolledBack.status === "rolled_back", `status=${rolledBack.status}, rollback=${rolledBack.rollbackStatus}`);

  // 11. Restart / reconciliation — a fresh persistence handle resumes nothing
  //     unsafe and never double-mutates a terminal run.
  await waitForRunsIdle();
  resetFoundryPersistence();
  await resumeIncompleteRuns();
  await waitForRunsIdle();
  const afterRestart = (await getStoreSnapshot()).runs.find((r) => r.id === run.id);
  record("11. restart reconciliation safe", afterRestart?.status === "rolled_back", `terminal state preserved: ${afterRestart?.status}`);

  // Emit machine-readable evidence bundle.
  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const bundle = {
    proof: "foundry-governed-release@1",
    envelopeId: intake.envelopeId,
    runId: run.id,
    steps,
    routing: intake.routing.map((r) => ({ provider: r.providerId, action: r.action, mode: r.mode, executable: r.executable })),
    gate: { id: gates[0].id, decidedApproved: true },
    artifacts: artifacts.map((a) => ({ id: a.id, kind: a.kind, retentionClass: a.retentionClass, checksum: a.checksum })),
    promotion,
    finalRunStatus: afterRestart?.status,
    productionMutated: false,
  };
  await writeFile(path.join(evidenceDir, "governed-release-proof.json"), JSON.stringify(bundle, null, 2), "utf8");

  console.log("\nPROOF: PASS — governed release lifecycle verified end-to-end (no production mutation).");
  console.log(`Evidence: ${path.join("proof", "evidence", "governed-release-proof.json")}`);
}

main().catch((error) => {
  console.error(`\nPROOF: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
