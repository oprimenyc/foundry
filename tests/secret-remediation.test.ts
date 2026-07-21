import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { ingestSecretExposureFinding, SecretExposureFindingValidationError, listRemediationEvidence } from "@/lib/secret-remediation/evidence";
import { scanForRawSecretMaterial } from "@/lib/secret-remediation/secret-scan";
import { computeRemediationVerdict, classifyProvider } from "@/lib/secret-remediation/types";
import { generateRemediationPlan } from "@/lib/secret-remediation/plan";
import { runApplicableAdapters, listRemediationAdapters } from "@/lib/secret-remediation/adapters/registry";
import { resetRemediationGates, listRemediationGates, decideRemediationGate, raiseGatesForPlan, RemediationGateError } from "@/lib/secret-remediation/gates";
import { getRemediationStatus, getRemediationOperatorReport } from "@/lib/secret-remediation/operator";
import { loadPanticandyFixtures } from "@/lib/secret-remediation/fixtures/panticandy.fixtures";
import { loadVitalcoreFixtures } from "@/lib/secret-remediation/fixtures/vitalcore.fixtures";
import { ingestAllFixtures } from "@/lib/secret-remediation/fixtures";
import type { SecretExposureFinding, SecretExposureFindingInput } from "@/lib/secret-remediation/types";

const testDir = path.join(process.cwd(), ".foundry-test-data", "secret-remediation");

async function resetEnv() {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(testDir, "artifacts");
  resetFoundryPersistence();
  resetRemediationGates();
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });
}

function baseFindingInput(overrides: Partial<SecretExposureFindingInput> = {}): SecretExposureFindingInput {
  return {
    project: "acme",
    filePath: ".env",
    sourceReference: "commit 0123abcd0123abcd0123abcd0123abcd01234567",
    secretCategory: "generic_env_secret",
    exposureLocation: "current_tracked_file",
    severity: "medium",
    containmentStatus: "contained",
    rotationRequired: false,
    historyRewriteRequired: "not_applicable",
    deploymentEnvUpdateRequired: false,
    ...overrides,
  };
}

function fakeFinding(overrides: Partial<SecretExposureFindingInput> = {}): SecretExposureFinding {
  const input = baseFindingInput(overrides);
  return {
    ...input,
    id: "secfind_test",
    providerClassification: classifyProvider(input.secretCategory),
    verdict: computeRemediationVerdict(input),
    createdAt: new Date().toISOString(),
  };
}

test("raw secret value is rejected outright, not merely redacted", async () => {
  await resetEnv();
  const withPat = baseFindingInput({ notes: "found token ghp_1234567890abcdefghij1234567890abcdEF" });
  await assert.rejects(() => ingestSecretExposureFinding(withPat), SecretExposureFindingValidationError);

  const withKeyValue = baseFindingInput({ notes: "raw line was API_SECRET=aVeryLongSecretValueHere123456" });
  await assert.rejects(() => ingestSecretExposureFinding(withKeyValue), SecretExposureFindingValidationError);

  const withUrlCreds = baseFindingInput({ notes: "connection string postgres://user:hunter2password@host:5432/db" });
  await assert.rejects(() => ingestSecretExposureFinding(withUrlCreds), SecretExposureFindingValidationError);

  // A plain git commit SHA must NOT be flagged as a raw secret (it's routine metadata).
  const matches = scanForRawSecretMaterial({ sourceReference: "04c356cf3cf4c467c704220f51a71b38c0415884" });
  assert.equal(matches.length, 0);
});

test("secretFingerprint must be a sha256 hash, never a raw value", async () => {
  await resetEnv();
  const bad = baseFindingInput({ secretFingerprint: "not-a-hash" });
  await assert.rejects(() => ingestSecretExposureFinding(bad), SecretExposureFindingValidationError);

  const good = baseFindingInput({ secretFingerprint: `sha256:${"a".repeat(64)}` });
  const { evidence } = await ingestSecretExposureFinding(good);
  assert.equal(evidence.finding.secretFingerprint, `sha256:${"a".repeat(64)}`);
});

test("GitHub PAT finding creates a rotation + revocation plan gated on live rotation and revocation", async () => {
  await resetEnv();
  const finding = fakeFinding(loadPanticandyFixtures()[0]);
  const plan = generateRemediationPlan(finding);
  assert.ok(plan.providerRotationSteps.length > 0);
  assert.ok(plan.revocationSteps.length > 0);
  const reasons = plan.humanApprovalGates.map((g) => g.reason);
  assert.ok(reasons.includes("live_provider_credential_rotation"));
  assert.ok(reasons.includes("credential_revocation"));
});

test("historical DB URL finding creates rotation steps plus a history-rewrite decision gate", async () => {
  await resetEnv();
  const fixture = loadPanticandyFixtures()[1];
  assert.equal(fixture.secretCategory, "database_url");
  assert.equal(fixture.historyRewriteRequired, "optional");
  const finding = fakeFinding(fixture);
  const plan = generateRemediationPlan(finding);
  assert.ok(plan.providerRotationSteps.some((s) => /rotate/i.test(s)));
  const reasons = plan.humanApprovalGates.map((g) => g.reason);
  assert.ok(reasons.includes("git_history_rewrite"));
  assert.ok(reasons.includes("force_push"));
  assert.ok(reasons.includes("deployment_env_mutation"));
});

test("vITALCore tracked .env finding creates an untrack + rotation plan", async () => {
  await resetEnv();
  const fixture = loadVitalcoreFixtures()[0];
  assert.equal(fixture.exposureLocation, "current_tracked_file");
  const finding = fakeFinding(fixture);
  const plan = generateRemediationPlan(finding);
  assert.ok(plan.immediateContainmentSteps.some((s) => /git rm --cached/.test(s)));
  assert.ok(plan.providerRotationSteps.length > 0);
});

test("Google OAuth secret finding requires live_provider_credential_rotation approval", async () => {
  await resetEnv();
  const fixture = loadVitalcoreFixtures().find((f) => f.secretCategory === "google_oauth_client_secret")!;
  const finding = fakeFinding(fixture);
  const plan = generateRemediationPlan(finding);
  const reasons = plan.humanApprovalGates.map((g) => g.reason);
  assert.ok(reasons.includes("live_provider_credential_rotation"));
  const advisories = runApplicableAdapters(finding, plan);
  const googleAdvisory = advisories.find((a) => a.provider === "google");
  assert.ok(googleAdvisory);
  assert.deepEqual(googleAdvisory!.requiredApproval, ["live_provider_credential_rotation"]);
});

test("NextAuth secret finding requires regeneration and a deployment env update", async () => {
  await resetEnv();
  const fixture = loadVitalcoreFixtures().find((f) => f.secretCategory === "nextauth_secret")!;
  const finding = fakeFinding(fixture);
  const plan = generateRemediationPlan(finding);
  assert.ok(plan.providerRotationSteps.some((s) => /generate a new random secret/i.test(s)));
  assert.ok(plan.deploymentEnvUpdateSteps.length > 0);
  const reasons = plan.humanApprovalGates.map((g) => g.reason);
  assert.ok(reasons.includes("deployment_env_mutation"));
  assert.ok(reasons.includes("production_restart_redeploy"));
});

test("history rewrite requires its own explicit approval, separate from rotation", async () => {
  await resetEnv();
  const finding = fakeFinding({ rotationRequired: true, historyRewriteRequired: "required", deploymentEnvUpdateRequired: false });
  const plan = generateRemediationPlan(finding);
  const reasons = plan.humanApprovalGates.map((g) => g.reason);
  assert.ok(reasons.includes("live_provider_credential_rotation"));
  assert.ok(reasons.includes("git_history_rewrite"));
  assert.ok(reasons.includes("force_push"));
  // Rewrite/force-push must be distinct gate entries from rotation/revocation — deciding one must not decide the other.
  const gates = raiseGatesForPlan(plan);
  const rewriteGate = gates.find((g) => g.reason === "git_history_rewrite")!;
  const rotationGate = gates.find((g) => g.reason === "live_provider_credential_rotation")!;
  assert.notEqual(rewriteGate.id, rotationGate.id);
  const decided = decideRemediationGate(rotationGate.id, "approved", "test-operator");
  assert.equal(decided.status, "approved");
  const stillPending = listRemediationGates({ planId: plan.id, status: "pending" });
  assert.ok(stillPending.some((g) => g.id === rewriteGate.id), "history rewrite gate must remain pending after rotation gate is approved");
});

test("a decided gate is immutable and an unknown gate errors", async () => {
  await resetEnv();
  const finding = fakeFinding({ rotationRequired: true });
  const plan = generateRemediationPlan(finding);
  const gates = raiseGatesForPlan(plan);
  const gate = gates[0];
  decideRemediationGate(gate.id, "approved", "test-operator");
  assert.throws(() => decideRemediationGate(gate.id, "rejected", "test-operator"), RemediationGateError);
  assert.throws(() => decideRemediationGate("nonexistent-gate", "approved", "test-operator"), RemediationGateError);
});

test("dry-run adapters never make a live call and always confirm no real mutation", async () => {
  await resetEnv();
  const finding = fakeFinding({ secretCategory: "github_pat", exposureLocation: "local_git_config", rotationRequired: true });
  const plan = generateRemediationPlan(finding);
  const advisories = runApplicableAdapters(finding, plan);
  assert.ok(advisories.length > 0);
  for (const advisory of advisories) {
    assert.equal(advisory.blocked, true);
    assert.equal(advisory.noRealMutationConfirmed, true);
  }
  assert.equal(listRemediationAdapters().length, 6);
});

test("evidence package stores no raw secret material", async () => {
  await resetEnv();
  const { evidence } = await ingestSecretExposureFinding(baseFindingInput({ secretCategory: "database_url", rotationRequired: true, notes: "clean note, no secret here" }));
  const serialized = JSON.stringify(evidence);
  assert.equal(scanForRawSecretMaterial(evidence).length, 0);
  assert.ok(!/ghp_[A-Za-z0-9]{20,}/.test(serialized));
  // The artifact actually written to disk is also clean.
  const artifactsDir = path.join(testDir, "artifacts");
  const files = await (await import("fs/promises")).readdir(artifactsDir);
  for (const file of files) {
    const content = await readFile(path.join(artifactsDir, file), "utf8");
    assert.equal(scanForRawSecretMaterial(JSON.parse(content)).length, 0);
  }
});

test("operator surface returns full remediation status for a finding and an aggregate report", async () => {
  await resetEnv();
  const { evidence } = await ingestSecretExposureFinding(baseFindingInput({ project: "opsurf-acme", secretCategory: "github_pat", exposureLocation: "local_git_config", severity: "high", containmentStatus: "contained", rotationRequired: true }));

  const status = await getRemediationStatus(evidence.findingId);
  assert.ok(status);
  assert.equal(status!.project, "opsurf-acme");
  assert.equal(status!.verdict, "PASS_WITH_WARNINGS");
  assert.ok(status!.requiredApprovals.includes("live_provider_credential_rotation"));
  assert.ok(status!.remainingOwnerActions.length > 0);
  assert.deepEqual(status!.liveStepsExecuted, []);

  const report = await getRemediationOperatorReport({ project: "opsurf-acme" });
  assert.equal(report.totalFindings, 1);
  assert.equal(report.bySeverity.high, 1);
  assert.equal(report.pendingApprovals > 0, true);
});

test("PantiCandy and vITALCore fixtures ingest end-to-end with no real provider calls", async () => {
  await resetEnv();
  const evidencePackages = await ingestAllFixtures();
  assert.equal(evidencePackages.length, 6);
  for (const evidence of evidencePackages) {
    assert.ok(["FAIL", "BLOCKED", "PASS_WITH_WARNINGS", "PASS"].includes(evidence.verdict));
    for (const advisory of evidence.advisories) {
      assert.equal(advisory.blocked, true);
      assert.equal(advisory.noRealMutationConfirmed, true);
    }
  }
  const listed = await listRemediationEvidence({});
  assert.equal(listed.length, 6);
});
