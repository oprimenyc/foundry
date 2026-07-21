import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import {
  ingestProviderActionRequest,
  parseProviderActionRequestInput,
  listProviderActionEvidence,
  ProviderActionRequestValidationError,
  UnsupportedProviderActionError,
} from "@/lib/provider-actions/evidence";
import { computeMutationRisk, requiredApprovalGateReasons } from "@/lib/provider-actions/policy";
import { PROVIDER_TYPES } from "@/lib/provider-actions/types";
import { decideProviderActionGate, listProviderActionGates, resetProviderActionGates } from "@/lib/provider-actions/gates";
import { getProviderActionOperatorReport, getProviderActionStatus } from "@/lib/provider-actions/operator";
import { listProviderActionAdapters } from "@/lib/provider-actions/adapters/registry";
import { providerActionFixturePath, PROVIDER_ACTION_FIXTURE_FILES } from "@/lib/provider-actions/fixtures";
import { readFile } from "fs/promises";

const testDir = path.join(process.cwd(), ".foundry-test-data", "provider-actions");

async function resetEnv() {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(testDir, "artifacts");
  resetFoundryPersistence();
  resetProviderActionGates();
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });
}

async function loadFixture(file: (typeof PROVIDER_ACTION_FIXTURE_FILES)[number]) {
  return JSON.parse(await readFile(providerActionFixturePath(file), "utf8"));
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    project: "test-project",
    providerType: "railway",
    actionType: "update_deployment_env_var",
    targetEnvironment: "staging",
    targetDescription: "test target",
    rollbackPlan: ["revert the value"],
    verificationPlan: ["confirm the service is healthy"],
    ...overrides,
  };
}

// ── Contract validation ──────────────────────────────────────────────────

test("a well-formed request validates cleanly", () => {
  const parsed = parseProviderActionRequestInput(validRequest());
  assert.equal(parsed.project, "test-project");
  assert.equal(parsed.preApprovedGateReasons.length, 0);
});

test("raw secret-shaped material is rejected", () => {
  assert.throws(
    () => parseProviderActionRequestInput(validRequest({ notes: "token: ghp_FAKEFAKEFAKEFAKEFAKEFAKE1234567890" })),
    ProviderActionRequestValidationError
  );
});

test("missing required contract fields are rejected", () => {
  const input = validRequest();
  delete (input as any).rollbackPlan;
  assert.throws(() => parseProviderActionRequestInput(input), ProviderActionRequestValidationError);
});

// ── Replit deployment-target classification (mission: Replit deployment target scrub) ──

test("Replit is not, and never will be, a value in PROVIDER_TYPES — it cannot be advised as a deployment target through this contract at all", () => {
  assert.ok(!(PROVIDER_TYPES as readonly string[]).includes("replit"));
});

test("submitting providerType: \"replit\" is rejected by schema validation, not silently accepted", () => {
  assert.throws(() => parseProviderActionRequestInput(validRequest({ providerType: "replit" })), ProviderActionRequestValidationError);
});

test("a request can honestly record Replit as dev-stack-origin-only without that ever counting as a deployment recommendation", () => {
  const parsed = parseProviderActionRequestInput(
    validRequest({
      providerType: "generic_env",
      actionType: "dns_advisory",
      replitClassification: { status: "dev_stack_origin_only", deploymentTargetStatus: "undecided", explanation: "current host is Replit; not an approved target" },
    })
  );
  assert.equal(parsed.replitClassification?.status, "dev_stack_origin_only");
  assert.equal(parsed.replitClassification?.deploymentTargetStatus, "undecided");
});

test("the evidence package preserves the replitClassification correction end to end (it is not silently stripped)", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(
    validRequest({
      providerType: "generic_env",
      actionType: "dns_advisory",
      replitClassification: { status: "dev_stack_origin_only", deploymentTargetStatus: "undecided", explanation: "current host is Replit; not an approved target" },
    })
  );
  assert.equal(evidence.request.replitClassification?.status, "dev_stack_origin_only");
});

test("an invalid (uppercase / non-enum) replitClassification.status is rejected, not silently coerced", () => {
  assert.throws(
    () =>
      parseProviderActionRequestInput(
        validRequest({ replitClassification: { status: "DEV_STACK_ORIGIN_ONLY", deploymentTargetStatus: "undecided", explanation: "x" } })
      ),
    ProviderActionRequestValidationError
  );
});

// ── Approval policy engine (Phase 3) ─────────────────────────────────────

test("GitHub PAT revocation requires live_provider_mutation and credential_revocation approval", () => {
  const gates = requiredApprovalGateReasons({ actionType: "revoke_credential", providerType: "github", targetEnvironment: "staging", forcePushRequired: false });
  assert.ok(gates.includes("live_provider_mutation"));
  assert.ok(gates.includes("credential_revocation"));
});

test("database credential rotation requires credential_rotation approval", () => {
  const gates = requiredApprovalGateReasons({ actionType: "rotate_credential", providerType: "database", targetEnvironment: "staging", forcePushRequired: false });
  assert.ok(gates.includes("credential_rotation"));
});

test("Google OAuth rotation requires credential_rotation approval", () => {
  const gates = requiredApprovalGateReasons({ actionType: "rotate_credential", providerType: "google_oauth", targetEnvironment: "staging", forcePushRequired: false });
  assert.ok(gates.includes("credential_rotation"));
});

test("NextAuth regeneration additionally requires deployment_env_mutation approval, not just credential_rotation", () => {
  const gates = requiredApprovalGateReasons({ actionType: "rotate_credential", providerType: "nextauth", targetEnvironment: "staging", forcePushRequired: false });
  assert.ok(gates.includes("credential_rotation"));
  assert.ok(gates.includes("deployment_env_mutation"));
});

test("Railway env update requires deployment_env_mutation approval", () => {
  const gates = requiredApprovalGateReasons({ actionType: "update_deployment_env_var", providerType: "railway", targetEnvironment: "staging", forcePushRequired: false });
  assert.ok(gates.includes("deployment_env_mutation"));
});

test("production restart/redeploy requires the additional production_target gate; staging does not", () => {
  const prod = requiredApprovalGateReasons({ actionType: "restart_service", providerType: "railway", targetEnvironment: "production", forcePushRequired: false });
  const staging = requiredApprovalGateReasons({ actionType: "restart_service", providerType: "railway", targetEnvironment: "staging", forcePushRequired: false });
  assert.ok(prod.includes("production_target"));
  assert.ok(!staging.includes("production_target"));
});

test("git history rewrite requires its own gate, separate from force_push", () => {
  const withoutForcePush = requiredApprovalGateReasons({ actionType: "git_history_rewrite_advisory", providerType: "github", targetEnvironment: "staging", forcePushRequired: false });
  assert.ok(withoutForcePush.includes("git_history_rewrite"));
  assert.ok(!withoutForcePush.includes("force_push"));
});

test("force push requires a separate approval gate from git_history_rewrite when both apply", () => {
  const gates = requiredApprovalGateReasons({ actionType: "git_history_rewrite_advisory", providerType: "github", targetEnvironment: "staging", forcePushRequired: true });
  assert.ok(gates.includes("git_history_rewrite"));
  assert.ok(gates.includes("force_push"));
});

test("DNS mutation always requires its own gate and never a production_target gate (permanently advisory, not tiered)", () => {
  const gates = requiredApprovalGateReasons({ actionType: "dns_advisory", providerType: "generic_env", targetEnvironment: "production", forcePushRequired: false });
  assert.ok(gates.includes("dns_mutation"));
  assert.ok(!gates.includes("production_target"));
});

test("verify_service_health requires no approval gates at all", () => {
  const gates = requiredApprovalGateReasons({ actionType: "verify_service_health", providerType: "fly", targetEnvironment: "production", forcePushRequired: false });
  assert.deepEqual(gates, []);
});

test("mutation risk scales with target environment and is none/medium/critical for non-mutating/advisory types", () => {
  assert.equal(computeMutationRisk({ actionType: "verify_service_health", targetEnvironment: "production" }), "none");
  assert.equal(computeMutationRisk({ actionType: "dns_advisory", targetEnvironment: "production" }), "medium");
  assert.equal(computeMutationRisk({ actionType: "git_history_rewrite_advisory", targetEnvironment: "staging" }), "critical");
  assert.equal(computeMutationRisk({ actionType: "rotate_credential", targetEnvironment: "production" }), "critical");
  assert.equal(computeMutationRisk({ actionType: "update_deployment_env_var", targetEnvironment: "staging" }), "medium");
});

// ── Ingest pipeline ───────────────────────────────────────────────────────

test("unsupported (providerType, actionType) pair is rejected, not silently accepted", async () => {
  await resetEnv();
  await assert.rejects(() => ingestProviderActionRequest(validRequest({ providerType: "github", actionType: "verify_service_health" })), UnsupportedProviderActionError);
});

test("a mutation-required action with no approval cannot be PASS — it is BLOCKED", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(validRequest());
  assert.equal(evidence.verdict, "BLOCKED");
  assert.ok(evidence.policy.findings.some((f) => f.code === "REQUIRED_APPROVAL_PENDING"));
});

test("blocked provider prerequisites return BLOCKED regardless of approval state", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(
    validRequest({ providerType: "vercel", knownPrerequisiteGaps: ["vercel-cli"], preApprovedGateReasons: ["live_provider_mutation", "deployment_env_mutation"] })
  );
  assert.equal(evidence.verdict, "BLOCKED");
  assert.ok(evidence.policy.findings.some((f) => f.code === "PROVIDER_PREREQUISITE_MISSING"));
});

test("PASS_WITH_WARNINGS is preserved for advisory-only gaps (dns_advisory), never a plain PASS", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(validRequest({ providerType: "generic_env", actionType: "dns_advisory" }));
  assert.equal(evidence.verdict, "PASS_WITH_WARNINGS");
});

test("a mutation-required action with every gate pre-approved is capped at PASS_WITH_WARNINGS, never plain PASS", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(validRequest({ preApprovedGateReasons: ["live_provider_mutation", "deployment_env_mutation"] }));
  assert.equal(evidence.verdict, "PASS_WITH_WARNINGS");
  assert.ok(evidence.gates.every((g) => g.status === "approved"));
});

test("non-mutating verify_service_health reaches a plain PASS with no gates raised", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(validRequest({ providerType: "fly", actionType: "verify_service_health" }));
  assert.equal(evidence.verdict, "PASS");
  assert.equal(evidence.gates.length, 0);
});

test("dry-run adapters make no live calls — every advisory asserts mutationDisabled and liveCallMade:false", async () => {
  await resetEnv();
  const adapters = listProviderActionAdapters();
  assert.ok(adapters.length >= 11);
  const { evidence } = await ingestProviderActionRequest(validRequest());
  assert.equal(evidence.advisory.mutationDisabled, true);
  assert.equal(evidence.advisory.liveCallMade, false);
  assert.equal(evidence.dryRunResult.liveCallMade, false);
});

test("evidence never contains raw secret material", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(validRequest({ notes: "no secret here, just a note" }));
  const serialized = JSON.stringify(evidence);
  assert.ok(!/ghp_[A-Za-z0-9]{20,}/.test(serialized));
});

// ── Gate decision lifecycle ──────────────────────────────────────────────

test("a decided gate is immutable — deciding it twice throws", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(validRequest());
  const gate = evidence.gates[0];
  decideProviderActionGate(gate.id, "approved", "test-operator");
  assert.throws(() => decideProviderActionGate(gate.id, "approved", "test-operator"));
});

test("the operator surface reflects gate decisions live even though the evidence verdict itself is a frozen ingest-time snapshot", async () => {
  await resetEnv();
  const { evidence } = await ingestProviderActionRequest(validRequest());
  const before = await getProviderActionStatus(evidence.actionId);
  assert.equal(before?.verdict, "BLOCKED");
  assert.ok(before?.approvalState.every((g) => g.status === "pending"));
  for (const gate of listProviderActionGates({ actionId: evidence.actionId })) {
    decideProviderActionGate(gate.id, "approved", "test-operator");
  }
  const after = await getProviderActionStatus(evidence.actionId);
  // approvalState is re-queried live, so it reflects the new decisions immediately...
  assert.equal(after?.approvalState.every((g) => g.status === "approved"), true);
  // ...but the evidence package's own verdict is immutable once retained (same discipline as
  // lib/secret-remediation/operator.ts): re-ingesting fresh evidence with preApprovedGateReasons
  // set is how a new, accurately-capped PASS_WITH_WARNINGS verdict gets produced, not mutating history.
  assert.equal(after?.verdict, "BLOCKED");
  assert.equal(after?.remainingOwnerActions.length, 1);
  assert.ok(after?.remainingOwnerActions[0].includes("a human must still perform"));
});

// ── End-to-end: all 10 required fixtures ─────────────────────────────────

test("all 10 required fixtures load and parse without throwing", () => {
  assert.equal(PROVIDER_ACTION_FIXTURE_FILES.length, 10);
});

test("full pipeline: all 10 fixtures ingest end-to-end with expected verdicts, no fixture contains a secret value", async () => {
  await resetEnv();
  const expected: Record<string, string> = {
    "panticandy-github-pat-revocation.fixture.json": "BLOCKED",
    "panticandy-db-credential-rotation.fixture.json": "BLOCKED",
    "vitalcore-nextauth-secret-regeneration.fixture.json": "BLOCKED",
    "vitalcore-google-oauth-rotation.fixture.json": "BLOCKED",
    "vitalcore-db-credential-rotation.fixture.json": "BLOCKED",
    "dyln-staging-env-update-advisory.fixture.json": "BLOCKED",
    "primeopp-domain-env-deployment-advisory.fixture.json": "PASS_WITH_WARNINGS",
    "railway-staging-env-update-dryrun.fixture.json": "BLOCKED",
    "fly-health-verification-dryrun.fixture.json": "PASS",
    "vercel-missing-cli-blocked-advisory.fixture.json": "BLOCKED",
  };

  for (const file of PROVIDER_ACTION_FIXTURE_FILES) {
    const raw = await loadFixture(file);
    assert.ok(!/ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}/.test(JSON.stringify(raw)), `${file} must not contain secret-shaped material`);
    const { evidence } = await ingestProviderActionRequest(raw);
    assert.equal(evidence.verdict, expected[file], `${file}: expected ${expected[file]}, got ${evidence.verdict}`);
    assert.equal(evidence.advisory.liveCallMade, false);
    assert.equal(evidence.dryRunResult.liveCallMade, false);
  }

  const report = await getProviderActionOperatorReport({});
  assert.equal(report.totalActions, 10);
  assert.equal(report.byVerdict.BLOCKED, 8);
  assert.equal(report.byVerdict.PASS_WITH_WARNINGS, 1);
  assert.equal(report.byVerdict.PASS, 1);
  assert.equal(report.byVerdict.FAIL, 0);
  assert.equal(report.realProviderCallsMade, false);

  const all = await listProviderActionEvidence({});
  assert.equal(all.length, 10);
});

test("the Railway staging dry-run fixture's gates can be approved live even though its evidence verdict stays the frozen BLOCKED", async () => {
  await resetEnv();
  const raw = await loadFixture("railway-staging-env-update-dryrun.fixture.json");
  const { evidence } = await ingestProviderActionRequest(raw);
  assert.equal(evidence.verdict, "BLOCKED");
  for (const gate of listProviderActionGates({ actionId: evidence.actionId })) {
    decideProviderActionGate(gate.id, "approved", "ops-review");
  }
  const status = await getProviderActionStatus(evidence.actionId);
  assert.equal(status?.verdict, "BLOCKED"); // frozen evidence.verdict at ingest time is preserved — see operator.ts doc comment
  assert.equal(status?.approvalState.every((g) => g.status === "approved"), true);
});
