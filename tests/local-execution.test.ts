import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { ingestLocalExecutionEvidence, loadLocalExecutionEvidenceFile } from "@/lib/local-execution/ingest";
import { evaluateLocalExecutionPolicy, findOutOfScopeFiles } from "@/lib/local-execution/policy";
import { recordLocalExecutionEvidence } from "@/lib/local-execution/evidence";
import { getLocalExecutionOperatorReport } from "@/lib/local-execution/operator";
import { localExecutionFixturePath, LOCAL_EXECUTION_FIXTURE_FILES } from "@/lib/local-execution/fixtures";

const testDir = path.join(process.cwd(), ".foundry-test-data", "local-execution");

async function resetEnv() {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(testDir, "artifacts");
  resetFoundryPersistence();
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });
}

function validEvidence(overrides: Record<string, unknown> = {}) {
  return {
    missionId: "mission-test",
    productTarget: "foundry",
    adapterType: "generic",
    criticality: "standard",
    allowedFileScope: ["lib/local-execution"],
    filesTouched: [],
    commandsRun: [{ command: "echo ok", commandClass: "read_only", exitCode: 0, wallClockMs: 5, retries: 0 }],
    cacheRefs: [],
    proofArtifacts: ["proof/evidence/test.json"],
    providerMutationOccurred: false,
    sourceMutationOccurred: false,
    ...overrides,
  };
}

// ── Ingest-time rejections ──────────────────────────────────────────────────

test("malformed evidence (not an object) is rejected", () => {
  const result = ingestLocalExecutionEvidence("not an object");
  assert.equal(result.status, "rejected");
  assert.equal((result as any).reason, "malformed_evidence");
});

test("missing missionId is rejected", () => {
  const input = validEvidence();
  delete (input as any).missionId;
  const result = ingestLocalExecutionEvidence(input);
  assert.equal(result.status, "rejected");
  assert.equal((result as any).reason, "missing_mission_id");
});

test("missing adapterType is rejected", () => {
  const input = validEvidence();
  delete (input as any).adapterType;
  const result = ingestLocalExecutionEvidence(input);
  assert.equal(result.status, "rejected");
  assert.equal((result as any).reason, "missing_adapter_type");
});

test("missing/empty command log is rejected", () => {
  const result = ingestLocalExecutionEvidence(validEvidence({ commandsRun: [] }));
  assert.equal(result.status, "rejected");
  assert.equal((result as any).reason, "missing_command_log");
});

test("evidence carrying secret-shaped material is rejected before policy runs", () => {
  const input = validEvidence({
    commandsRun: [{ command: "curl -H 'Authorization: Bearer ghp_FAKEFAKEFAKEFAKEFAKEFAKE1234567890'", commandClass: "read_only", exitCode: 0, wallClockMs: 5, retries: 0 }],
  });
  const result = ingestLocalExecutionEvidence(input);
  assert.equal(result.status, "rejected");
  assert.equal((result as any).reason, "secret_exposure_detected");
  // The raw secret text must never appear in the rejection record.
  assert.ok(!JSON.stringify(result).includes("ghp_FAKEFAKEFAKEFAKEFAKEFAKE1234567890"));
});

test("provider mutation claimed with no gate reference at all is rejected outright", () => {
  const result = ingestLocalExecutionEvidence(validEvidence({ providerMutationOccurred: true }));
  assert.equal(result.status, "rejected");
  assert.equal((result as any).reason, "unapproved_provider_mutation_claim");
});

test("provider mutation claimed WITH a gate reference (even if unapproved) is accepted, not rejected", () => {
  const result = ingestLocalExecutionEvidence(
    validEvidence({ providerMutationOccurred: true, providerMutationGate: { gateId: "g1", approved: false } })
  );
  assert.equal(result.status, "accepted");
  if (result.status === "accepted") {
    assert.equal(result.record.verdict, "BLOCKED");
    assert.ok(result.record.policy.requiredEscalations.includes("provider_mutation_requires_approval"));
  }
});

// ── Policy evaluation ───────────────────────────────────────────────────────

test("out-of-scope file mutation is detected", () => {
  const files = findOutOfScopeFiles(["lib/local-execution/types.ts", "lib/other-module/index.ts"], ["lib/local-execution"]);
  assert.deepEqual(files, ["lib/other-module/index.ts"]);
});

test("forbidden command class (git_history_rewrite) fails", () => {
  const evaluation = evaluateLocalExecutionPolicy({
    criticality: "standard",
    commandsRun: [{ command: "git filter-repo", commandClass: "git_history_rewrite", exitCode: 0, wallClockMs: 5, retries: 0 }],
    filesTouched: [],
    allowedFileScope: ["lib"],
    proofArtifacts: ["p.json"],
    providerMutationOccurred: false,
    sourceMutationOccurred: false,
    secretScanOk: true,
  });
  assert.equal(evaluation.verdict, "FAIL");
});

test("a run where every command fails is BLOCKED, not merely a warning", () => {
  const evaluation = evaluateLocalExecutionPolicy({
    criticality: "standard",
    commandsRun: [{ command: "jcode run", commandClass: "read_only", exitCode: 127, wallClockMs: 5, retries: 0 }],
    filesTouched: [],
    allowedFileScope: ["lib"],
    proofArtifacts: [],
    providerMutationOccurred: false,
    sourceMutationOccurred: false,
    secretScanOk: true,
  });
  assert.equal(evaluation.verdict, "BLOCKED");
});

test("missing proof artifacts warns at standard criticality but fails at high criticality", () => {
  const base = {
    commandsRun: [{ command: "echo ok", commandClass: "read_only" as const, exitCode: 0, wallClockMs: 5, retries: 0 }],
    filesTouched: [],
    allowedFileScope: ["lib"],
    proofArtifacts: [],
    providerMutationOccurred: false,
    sourceMutationOccurred: false,
    secretScanOk: true,
  };
  const standard = evaluateLocalExecutionPolicy({ ...base, criticality: "standard" });
  const high = evaluateLocalExecutionPolicy({ ...base, criticality: "high" });
  assert.equal(standard.verdict, "PASS_WITH_WARNINGS");
  assert.equal(high.verdict, "FAIL");
});

test("high-risk domain command class requires frontier review and escalation", () => {
  const evaluation = evaluateLocalExecutionPolicy({
    criticality: "standard",
    commandsRun: [{ command: "psql -c 'DROP TABLE users'", commandClass: "database_change", exitCode: 0, wallClockMs: 5, retries: 0 }],
    filesTouched: [],
    allowedFileScope: ["lib"],
    proofArtifacts: ["p.json"],
    providerMutationOccurred: false,
    sourceMutationOccurred: false,
    secretScanOk: true,
  });
  assert.equal(evaluation.verdict, "BLOCKED");
  assert.equal(evaluation.frontierReviewRequired, true);
  assert.ok(evaluation.requiredEscalations.includes("high_risk_domain_touched"));
});

test("a slow-but-successful run is PASS_WITH_WARNINGS, not FAIL", () => {
  const evaluation = evaluateLocalExecutionPolicy({
    criticality: "standard",
    commandsRun: [{ command: "ollama run big-model", commandClass: "test_run", exitCode: 0, wallClockMs: 200_000, retries: 0 }],
    filesTouched: [],
    allowedFileScope: ["lib"],
    proofArtifacts: ["p.json"],
    providerMutationOccurred: false,
    sourceMutationOccurred: false,
    secretScanOk: true,
  });
  assert.equal(evaluation.verdict, "PASS_WITH_WARNINGS");
});

test("a clean run with no findings is a plain PASS", () => {
  const evaluation = evaluateLocalExecutionPolicy({
    criticality: "high",
    commandsRun: [{ command: "echo ok", commandClass: "read_only", exitCode: 0, wallClockMs: 5, retries: 0 }],
    filesTouched: [],
    allowedFileScope: ["lib"],
    proofArtifacts: ["p.json"],
    providerMutationOccurred: false,
    sourceMutationOccurred: false,
    secretScanOk: true,
  });
  assert.equal(evaluation.verdict, "PASS");
});

// ── End-to-end: all 6 required fixtures ─────────────────────────────────────

test("all 6 required fixtures load and parse without throwing", () => {
  assert.equal(LOCAL_EXECUTION_FIXTURE_FILES.length, 6);
});

test("full pipeline: all 6 fixtures ingest end-to-end with expected verdicts, operator report aggregates correctly", async () => {
  await resetEnv();
  const expected: Record<string, { status: "accepted" | "rejected"; verdict: string | null }> = {
    "jcode-blocked.fixture.json": { status: "accepted", verdict: "BLOCKED" },
    "wigolo-blocked.fixture.json": { status: "accepted", verdict: "BLOCKED" },
    "ollama-cpu-slow.fixture.json": { status: "accepted", verdict: "PASS_WITH_WARNINGS" },
    "primeos-tier-proof.fixture.json": { status: "accepted", verdict: "PASS" },
    "blocked-provider-mutation.fixture.json": { status: "accepted", verdict: "BLOCKED" },
    "blocked-secret-exposure.fixture.json": { status: "rejected", verdict: null },
  };

  for (const file of LOCAL_EXECUTION_FIXTURE_FILES) {
    const raw = await loadLocalExecutionEvidenceFile(localExecutionFixturePath(file));
    const { result } = await recordLocalExecutionEvidence(raw, { source: `fixture:${file}` });
    const actualVerdict = result.status === "accepted" ? result.record.verdict : null;
    assert.equal(result.status, expected[file].status, `${file}: expected status ${expected[file].status}, got ${result.status}`);
    assert.equal(actualVerdict, expected[file].verdict, `${file}: expected verdict ${expected[file].verdict}, got ${actualVerdict}`);
    if (result.status === "accepted") {
      assert.equal(result.record.requiresIndependentVerification, true);
    }
  }

  const report = await getLocalExecutionOperatorReport({});
  assert.equal(report.totalSubmissions, 6);
  assert.equal(report.accepted, 5);
  assert.equal(report.rejected, 1);
  assert.equal(report.byVerdict.BLOCKED, 3);
  assert.equal(report.byVerdict.PASS_WITH_WARNINGS, 1);
  assert.equal(report.byVerdict.PASS, 1);
  assert.equal(report.byVerdict.FAIL, 0);
});

test("operator report entry for a rejected submission never fabricates a verdict", async () => {
  await resetEnv();
  const raw = await loadLocalExecutionEvidenceFile(localExecutionFixturePath("blocked-secret-exposure.fixture.json"));
  await recordLocalExecutionEvidence(raw, { source: "test" });
  const report = await getLocalExecutionOperatorReport({});
  const rejectedEntry = report.entries.find((e) => e.status === "rejected");
  assert.ok(rejectedEntry);
  assert.equal(rejectedEntry?.localVerdict, null);
  assert.ok(rejectedEntry?.rejectionReason?.includes("secret_exposure_detected"));
});
