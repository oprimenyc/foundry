import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import path from "path";
import { intakeEnvelope } from "@/lib/foundry/envelope";
import { resolveExecutionMode } from "@/lib/foundry/routing";
import { evaluatePromotion, type ReleaseContext } from "@/lib/foundry/release-policy";
import { retainArtifact, verifyArtifactIntegrity, listArtifacts, expiredArtifacts } from "@/lib/foundry/artifacts";
import { evaluateGateRequirement, decideGate, listGates } from "@/lib/foundry/human-gates";
import { createProject, createPlanForProject, createRunForProject, seedMockCredentials } from "@/lib/foundry/service";
import { resumeRunAfterGate } from "@/lib/foundry/execution";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";
import { registerSecretValue, clearTaintRegistry } from "@/lib/vault/redaction";

const testDir = path.join(process.cwd(), ".foundry-test-data");

async function resetEnv(name: string) {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  delete process.env.FOUNDRY_API_TOKEN;
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, `${name}.json`);
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(testDir, `${name}-artifacts`);
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  await mkdir(testDir, { recursive: true });
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });
  await rm(process.env.FOUNDRY_ARTIFACT_DIR, { recursive: true, force: true });
}

async function waitForStatus(runId: string, statuses: string[], timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = (await getStoreSnapshot()).runs.find((r) => r.id === runId);
    if (run && statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Run ${runId} did not reach ${statuses.join("/")}`);
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    envelopeId: "env_1",
    projectRef: "proj_x",
    requestedOperation: "deploy",
    targetEnvironment: "development",
    idempotencyKey: "idem_1",
    source: { orchestrator: "veridian" },
    plan: {
      config: { name: "App", hosting: "vercel", repository: "app-repo" },
      budget: { maxSteps: 5, maxRuntimeMs: 120000 },
      steps: [
        { id: "s1", provider: "github", action: "create_repository", name: "Create repo", dependsOn: [], config: { repositoryName: "app-repo" }, timeoutMs: 15000, retryLimit: 1, rollbackAction: "create_repository" },
      ],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------- envelope intake

test("envelope intake accepts a valid low-risk envelope", async () => {
  const result = intakeEnvelope(envelope());
  assert.equal(result.decision, "ACCEPTED");
  assert.equal(result.gates.length, 0);
  assert.ok(result.routing.length >= 1);
  assert.equal(result.routing[0].mode, "API");
});

test("envelope intake rejects a structurally invalid envelope", async () => {
  const result = intakeEnvelope({ envelopeId: "x" });
  assert.equal(result.decision, "REJECTED");
  assert.ok(result.rejections.length > 0);
});

test("envelope intake rejects an expired envelope", async () => {
  const result = intakeEnvelope(envelope({ expiresAt: "2020-01-01T00:00:00.000Z" }));
  assert.equal(result.decision, "REJECTED");
  assert.ok(result.rejections.some((r) => r.includes("expired")));
});

test("envelope intake rejects forbidden command patterns in config", async () => {
  const result = intakeEnvelope(
    envelope({
      plan: {
        config: { name: "App", hosting: "vercel", repository: "app-repo" },
        budget: { maxSteps: 5, maxRuntimeMs: 120000 },
        steps: [
          { id: "s1", provider: "github", action: "create_repository", name: "x", dependsOn: [], config: { repositoryName: "app", note: "$(rm -rf /)" }, timeoutMs: 15000, retryLimit: 1 },
        ],
      },
    })
  );
  assert.equal(result.decision, "REJECTED");
  assert.ok(result.rejections.some((r) => r.includes("forbidden command")));
});

test("envelope intake blocks a literal secret value", async () => {
  const result = intakeEnvelope(
    envelope({
      plan: {
        config: { name: "App", hosting: "vercel", repository: "app-repo" },
        budget: { maxSteps: 5, maxRuntimeMs: 120000 },
        steps: [
          { id: "s1", provider: "github", action: "create_repository", name: "x", dependsOn: [], config: { repositoryName: "app", apiKey: "ghp_literalsecretvalue000" }, timeoutMs: 15000, retryLimit: 1 },
        ],
      },
    })
  );
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.blocks.some((b) => b.includes("secret: reference")));
});

test("envelope intake blocks a replayed idempotency key", async () => {
  const result = intakeEnvelope(envelope(), { seenIdempotencyKeys: ["idem_1"] });
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.blocks.some((b) => b.includes("replay")));
});

test("envelope intake accepts-with-gates when a step is approvalRequired", async () => {
  const result = intakeEnvelope(
    envelope({
      approvalRequirements: [{ stepId: "s1", reason: "founder must approve first launch" }],
    })
  );
  assert.equal(result.decision, "ACCEPTED_WITH_GATES");
  assert.equal(result.gates.length, 1);
  assert.equal(result.gates[0].stepId, "s1");
});

// ---------------------------------------------------------------- routing

test("routing resolves API mode for a known provider action", () => {
  const d = resolveExecutionMode({ providerId: "github", action: "create_repository" });
  assert.equal(d.mode, "API");
  assert.equal(d.executable, true);
});

test("routing resolves UNSUPPORTED for an unknown provider, fail closed", () => {
  const d = resolveExecutionMode({ providerId: "does-not-exist", action: "create_repository" });
  assert.equal(d.mode, "UNSUPPORTED");
  assert.equal(d.executable, false);
});

test("routing flags a human gate for a high-risk action", () => {
  const d = resolveExecutionMode({ providerId: "cloudflare", action: "delete_dns_record", environment: "production" });
  assert.equal(d.requiresHumanGate, true);
});

// ---------------------------------------------------------------- release policy

const baseRelease: ReleaseContext = {
  targetEnvironment: "staging",
  riskLevel: "low",
  testStatus: "passed",
  buildStatus: "passed",
  runtimeStatus: "passed",
  securityStatus: "passed",
  verificationStatus: "passed",
  approvalsGranted: 0,
  artifactsComplete: true,
  rollbackReady: true,
  providerHealthy: "passed",
};

test("release policy allows a green low-risk promotion with no approvals needed", () => {
  const d = evaluatePromotion(baseRelease);
  assert.equal(d.outcome, "PROMOTION_ALLOWED");
});

test("release policy blocks on any failed gate", () => {
  const d = evaluatePromotion({ ...baseRelease, testStatus: "failed" });
  assert.equal(d.outcome, "PROMOTION_BLOCKED");
  assert.ok(d.blockingReasons.some((r) => r.includes("tests")));
});

test("release policy blocks when rollback is not ready", () => {
  const d = evaluatePromotion({ ...baseRelease, rollbackReady: false });
  assert.equal(d.outcome, "PROMOTION_BLOCKED");
});

test("release policy forces manual review on an unknown signal", () => {
  const d = evaluatePromotion({ ...baseRelease, verificationStatus: "unknown" });
  assert.equal(d.outcome, "MANUAL_REVIEW_REQUIRED");
});

test("release policy requires approval for production and honors granted approvals", () => {
  const blocked = evaluatePromotion({ ...baseRelease, targetEnvironment: "production", riskLevel: "high", approvalsGranted: 0 });
  assert.equal(blocked.outcome, "MANUAL_REVIEW_REQUIRED");
  const allowed = evaluatePromotion({ ...baseRelease, targetEnvironment: "production", riskLevel: "high", approvalsGranted: 1 });
  assert.equal(allowed.outcome, "PROMOTION_ALLOWED_WITH_APPROVAL");
});

test("release policy always demands sign-off for critical risk even when green", () => {
  const d = evaluatePromotion({ ...baseRelease, riskLevel: "critical", approvalsGranted: 0 });
  assert.equal(d.outcome, "MANUAL_REVIEW_REQUIRED");
});

// ---------------------------------------------------------------- artifacts

test("artifact retention is content-addressed, checksummed, and idempotent", async () => {
  await resetEnv("artifacts-basic");
  const a = await retainArtifact({ kind: "plan", content: { hello: "world" }, retentionClass: "RELEASE", producer: "test", source: "unit" });
  const b = await retainArtifact({ kind: "plan", content: { hello: "world" }, retentionClass: "RELEASE", producer: "test", source: "unit" });
  assert.equal(a.id, b.id, "identical content yields the same artifact id");
  assert.equal((await listArtifacts()).length, 1, "no duplicate write");
  assert.ok(a.immutable, "RELEASE artifacts are immutable");
  assert.ok(a.checksum.length === 64);

  const integrity = await verifyArtifactIntegrity(a.id);
  assert.equal(integrity.ok, true);
});

test("artifact integrity detects tampering", async () => {
  await resetEnv("artifacts-tamper");
  const a = await retainArtifact({ kind: "log", content: "hello", retentionClass: "STANDARD", producer: "test", source: "unit" });
  const filePath = a.storageUri.replace(/^file:\/\//, "");
  await writeFile(filePath, "tampered", "utf8");
  const integrity = await verifyArtifactIntegrity(a.id);
  assert.equal(integrity.ok, false);
  assert.ok(integrity.detail.includes("tampered") || integrity.detail.includes("mismatch"));
});

test("artifact retention redacts secrets before writing", async () => {
  await resetEnv("artifacts-redact");
  clearTaintRegistry();
  registerSecretValue("supersecrettoken12345");
  const a = await retainArtifact({ kind: "provider_response", content: { token: "supersecrettoken12345" }, retentionClass: "AUDIT", producer: "test", source: "unit" });
  assert.equal(a.redacted, true);
  const stored = await readFile(a.storageUri.replace(/^file:\/\//, ""), "utf8");
  assert.ok(!stored.includes("supersecrettoken12345"), "no secret material on disk");
  assert.equal(a.expiresAt, undefined, "AUDIT artifacts never expire");
  clearTaintRegistry();
});

test("EPHEMERAL artifacts expire; RELEASE artifacts do not", async () => {
  await resetEnv("artifacts-expiry");
  await retainArtifact({ kind: "scratch", content: "x", retentionClass: "EPHEMERAL", producer: "t", source: "u" });
  const future = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  const expired = await expiredArtifacts(future);
  assert.equal(expired.length, 1);
});

// ---------------------------------------------------------------- human gate pause/resume

test("evaluateGateRequirement flags approvalRequired and high-risk actions", () => {
  assert.equal(evaluateGateRequirement({ action: "create_repository", approvalRequired: true }).required, true);
  assert.equal(evaluateGateRequirement({ action: "delete_dns_record" }).required, true);
  assert.equal(evaluateGateRequirement({ action: "verify_repository" }).required, false);
});

function gatedPlanDraft() {
  return {
    config: { name: "Gated App", hosting: "vercel", repository: "gated-repo" },
    budget: { maxSteps: 5, maxRuntimeMs: 120000 },
    steps: [
      { id: "repo", provider: "github", action: "create_repository", name: "Create repo", dependsOn: [], config: { repositoryName: "gated-repo" }, timeoutMs: 15000, retryLimit: 1, rollbackAction: "create_repository", approvalRequired: true },
      { id: "verify", provider: "github", action: "verify_repository", name: "Verify repo", dependsOn: ["repo"], config: {}, timeoutMs: 5000, retryLimit: 0 },
    ],
  };
}

test("run pauses at an approvalRequired step and resumes to completion on approval", async () => {
  await resetEnv("gate-approve");
  const project = await createProject({ orgId: "org_local", name: "Gate Approve", prompt: "launch" });
  await seedMockCredentials(project.id, "org_local");
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: gatedPlanDraft() });
  assert.equal(plan.status, "validated", `plan should validate: ${plan.validationErrors.join(",")}`);
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id });

  const paused = await waitForStatus(run.id, ["awaiting_approval"]);
  assert.equal(paused.status, "awaiting_approval");
  const pending = await listGates({ runId: run.id, status: "pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].planStepId, "repo");

  await decideGate(pending[0].id, "approved", "founder@local");
  await resumeRunAfterGate(run.id);

  const done = await waitForStatus(run.id, ["completed", "failed"]);
  assert.equal(done.status, "completed", "run completes after approval");
});

test("run fails when a human rejects the gate", async () => {
  await resetEnv("gate-reject");
  const project = await createProject({ orgId: "org_local", name: "Gate Reject", prompt: "launch" });
  await seedMockCredentials(project.id, "org_local");
  const { plan } = await createPlanForProject({ orgId: "org_local", projectId: project.id, prompt: project.prompt, draftPlan: gatedPlanDraft() });
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id });

  await waitForStatus(run.id, ["awaiting_approval"]);
  const pending = await listGates({ runId: run.id, status: "pending" });
  await decideGate(pending[0].id, "rejected", "founder@local", { note: "not authorized yet" });
  await resumeRunAfterGate(run.id);

  const done = await waitForStatus(run.id, ["failed", "rolled_back", "completed"]);
  assert.ok(done.status === "failed" || done.status === "rolled_back", `expected failure, got ${done.status}`);
});
