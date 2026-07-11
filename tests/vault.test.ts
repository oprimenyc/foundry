import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm } from "fs/promises";
import path from "path";
import {
  registerSecretReference,
  getSecretReference,
  findReferencesForProvider,
  resetSecretReferences,
} from "@/lib/vault/registry";
import {
  evaluatePolicy,
  classifyActionRisk,
  setGlobalKillSwitch,
  setEmergencyDenyAll,
  setProviderKillSwitch,
  resetKillSwitches,
} from "@/lib/vault/policy";
import { requestApproval, decideApproval, resetApprovals } from "@/lib/vault/approvals";
import { issueExecutionGrant, consumeGrant, revokeGrant, resetGrants } from "@/lib/vault/leases";
import { configureVaultAdapter, resolveSecretsForExecution, releaseLeases } from "@/lib/vault/resolver";
import { MemoryVaultAdapter } from "@/lib/vault/adapters/memory";
import {
  redactString,
  redactValue,
  redactUrl,
  redactHeaders,
  clearTaintRegistry,
  containsSecretMaterial,
  REDACTED,
} from "@/lib/vault/redaction";
import {
  authorizeStepExecution,
  registerRunVaultContext,
  attachGrantToRun,
  resetRunVaultContexts,
} from "@/lib/vault/execution-gate";
import { VaultAccessError, type VaultAccessRequest } from "@/lib/vault/types";
import { selectProvider } from "@/lib/foundry/universal/selection";
import {
  recordObservation,
  openIncident,
  resolveIncident,
  computeIntelligenceScore,
  resetIntelligence,
} from "@/lib/foundry/universal/intelligence";
import { resetHealthState } from "@/lib/foundry/universal/health";
import { createProject, createPlanForProject, createRunForProject, seedMockCredentials } from "@/lib/foundry/service";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";

const testDir = path.join(process.cwd(), ".foundry-test-data");

function resetVaultState() {
  resetSecretReferences();
  resetApprovals();
  resetGrants();
  resetKillSwitches();
  resetRunVaultContexts();
  resetIntelligence();
  clearTaintRegistry();
}

function makeRequest(overrides: Partial<VaultAccessRequest> = {}): VaultAccessRequest {
  return {
    requestId: "req_test",
    organizationId: "org_a",
    projectId: "proj_a",
    environment: "development",
    machineIdentity: "svc://foundry/test",
    runId: "run_1",
    capability: "hosting",
    providerId: "railway",
    targetResource: "app-1",
    intendedAction: "create_project",
    secretReferenceIds: [],
    estimatedCostUsd: 1,
    riskLevel: "moderate",
    requestedDurationMs: 60_000,
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

// V1. Reference registry: metadata only, scoped, no enumeration signal
test("secret references are metadata-only and scope violations read as nonexistence", () => {
  resetVaultState();
  assert.throws(
    () =>
      registerSecretReference({
        organizationId: "org_a",
        projectId: "proj_a",
        environment: "production",
        displayName: "leaky",
        capabilities: [],
        requiresApproval: false,
        value: "hunter2",
      } as never),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("reference_carries_value")
  );

  const reference = registerSecretReference({
    organizationId: "org_a",
    projectId: "proj_a",
    environment: "production",
    providerId: "railway",
    displayName: "Railway token",
    capabilities: [],
    requiresApproval: false,
  });
  assert.ok(reference.id.startsWith("sref_"));
  assert.ok(!("value" in reference));

  // Same org/project at production scope reads fine.
  const got = getSecretReference(reference.id, {
    organizationId: "org_a",
    projectId: "proj_a",
    environment: "production",
    actor: "test",
  });
  assert.equal(got.displayName, "Railway token");

  // Cross-tenant and environment escalation both read as nonexistence.
  for (const scope of [
    { organizationId: "org_b", projectId: "proj_a", environment: "production" as const, actor: "test" },
    { organizationId: "org_a", projectId: "proj_b", environment: "production" as const, actor: "test" },
    { organizationId: "org_a", projectId: "proj_a", environment: "development" as const, actor: "test" },
  ]) {
    assert.throws(() => getSecretReference(reference.id, scope), /not found/);
  }
  resetVaultState();
});

// V2. Policy engine: deterministic risk, fail-closed approvals, kill switches
test("policy fails closed: kill switches, cost ceilings, high risk without manual approval", () => {
  resetVaultState();
  assert.equal(classifyActionRisk("delete_production_database", "production"), "critical");
  assert.equal(classifyActionRisk("transfer_funds", "development"), "critical");
  assert.equal(classifyActionRisk("delete_project", "development"), "high");
  assert.equal(classifyActionRisk("configure_dns_record", "development"), "high");
  assert.equal(classifyActionRisk("deploy_service", "development"), "moderate");
  assert.equal(classifyActionRisk("deploy_service", "production"), "high");
  assert.equal(classifyActionRisk("read_status", "production"), "low");

  setEmergencyDenyAll(true, "test");
  assert.equal(evaluatePolicy(makeRequest()).allow, false);
  setEmergencyDenyAll(false, "test");
  setGlobalKillSwitch(true, "test");
  assert.equal(evaluatePolicy(makeRequest()).allow, false);
  setGlobalKillSwitch(false, "test");

  const overBudget = evaluatePolicy(makeRequest({ estimatedCostUsd: 150 }));
  assert.equal(overBudget.allow, false);
  assert.ok(overBudget.reasonCodes.includes("cost_ceiling_exceeded"));

  const high = makeRequest({ intendedAction: "delete_project", riskLevel: "high" });
  const noApproval = evaluatePolicy(high);
  assert.equal(noApproval.allow, false);
  assert.ok(noApproval.reasonCodes.includes("manual_approval_required"));

  const approval = requestApproval(high);
  decideApproval(approval.approvalId, "approved", "founder", { mode: "allow_once" });
  const approved = evaluatePolicy(high, { approvalId: approval.approvalId });
  assert.equal(approved.allow, true);
  assert.equal(approved.approvalSource, "manual");

  // Approval bound to a different run never transfers.
  const otherRun = evaluatePolicy(makeRequest({ ...high, runId: "run_other" }), { approvalId: approval.approvalId });
  assert.equal(otherRun.allow, false);
  assert.ok(otherRun.reasonCodes.includes("approval_run_mismatch"));
  resetVaultState();
});

// V3. Standing approvals authorize low/moderate only
test("standing approvals authorize recurring moderate actions but never high risk", () => {
  resetVaultState();
  const moderate = makeRequest();
  const standing = requestApproval(moderate, "allow_recurring_policy");
  decideApproval(standing.approvalId, "approved", "founder");

  const decision = evaluatePolicy(makeRequest({ runId: "run_later" }));
  assert.equal(decision.allow, true);
  assert.equal(decision.approvalSource, "standing");

  // Same standing record cannot satisfy a high-risk request.
  const high = evaluatePolicy(makeRequest({ intendedAction: "delete_project", riskLevel: "high", runId: "run_later" }));
  assert.equal(high.allow, false);
  assert.ok(high.reasonCodes.includes("manual_approval_required"));
  resetVaultState();
});

// V4. Execution grants: single-use, scoped, revocable, non-transferable
test("execution grants are single-use, bound to run/provider/action, and revocable", () => {
  resetVaultState();
  const request = makeRequest();
  assert.throws(
    () => issueExecutionGrant(request, { ...evaluatePolicy(makeRequest({ estimatedCostUsd: 1000 })) }),
    /denied decision/
  );
  const decision = evaluatePolicy(request);
  const grant = issueExecutionGrant(request, decision);

  const context = {
    runId: request.runId,
    providerId: request.providerId,
    capability: request.capability,
    action: request.intendedAction,
    secretReferenceIds: [] as string[],
  };
  for (const [broken, reason] of [
    [{ ...context, runId: "run_other" }, "grant_run_mismatch"],
    [{ ...context, providerId: "netlify" }, "grant_provider_mismatch"],
    [{ ...context, action: "delete_project" }, "grant_action_mismatch"],
    [{ ...context, scope: "rollback" as const }, "grant_scope_mismatch"],
    [{ ...context, secretReferenceIds: ["sref_unlisted"] }, "grant_reference_not_allowed"],
  ] as const) {
    assert.throws(
      () => consumeGrant(grant.grantId, { ...broken, secretReferenceIds: [...broken.secretReferenceIds] }),
      (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes(reason)
    );
  }

  const used = consumeGrant(grant.grantId, context);
  assert.equal(used.useCount, 1);
  assert.throws(
    () => consumeGrant(grant.grantId, context),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("grant_uses_exhausted")
  );

  const second = issueExecutionGrant(request, evaluatePolicy(request));
  revokeGrant(second.grantId, "test revocation", "test");
  assert.throws(
    () => consumeGrant(second.grantId, context),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("grant_revoked")
  );
  resetVaultState();
});

// V5. Trusted resolver end to end + taint redaction
test("trusted resolver leases secrets only via a valid grant and redaction scrubs the plaintext", async () => {
  resetVaultState();
  const globalAdapter = globalThis as unknown as { __primeVaultAdapter?: unknown };
  globalAdapter.__primeVaultAdapter = undefined;
  await assert.rejects(
    resolveSecretsForExecution(makeRequest(), issueExecutionGrant(makeRequest(), evaluatePolicy(makeRequest()))),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("no_adapter")
  );
  resetGrants();

  const adapter = new MemoryVaultAdapter();
  configureVaultAdapter(adapter);
  const reference = registerSecretReference({
    organizationId: "org_a",
    projectId: "proj_a",
    environment: "development",
    providerId: "railway",
    displayName: "Railway deploy token",
    capabilities: ["hosting"],
    requiresApproval: false,
  });
  const plaintext = "rw_secret_value_9f8e7d6c";
  adapter.seedValue(reference.id, plaintext);

  const request = makeRequest({ secretReferenceIds: [reference.id] });
  const grant = issueExecutionGrant(request, evaluatePolicy(request));
  const leases = await resolveSecretsForExecution(request, grant);
  assert.equal(leases.length, 1);
  assert.equal(leases[0].read(), plaintext);

  // The released value is tainted: it never survives a trust boundary.
  assert.equal(redactString(`deploy failed: token ${plaintext} rejected`).includes(plaintext), false);
  assert.equal(containsSecretMaterial(`{"token":"${plaintext}"}`), true);
  assert.equal(containsSecretMaterial("clean payload"), false);

  await releaseLeases(leases);
  assert.throws(() => leases[0].read(), /released/);

  // Grant was single-use: a replay fails closed.
  await assert.rejects(
    resolveSecretsForExecution(request, grant),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("grant_uses_exhausted")
  );

  // Kill switch blocks resolution even with a fresh, valid grant.
  const fresh = issueExecutionGrant(request, evaluatePolicy(request));
  setGlobalKillSwitch(true, "test");
  await assert.rejects(
    resolveSecretsForExecution(request, fresh),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("kill_switch_active")
  );
  resetVaultState();
});

// V6. Redaction layers
test("redaction masks sensitive keys, bearer tokens, provider key shapes, and URL credentials", () => {
  clearTaintRegistry();
  assert.equal(redactString("Authorization: Bearer abcdef123456789").includes("abcdef"), false);
  assert.equal(redactString("key sk_live_abcdefgh12345678").includes("sk_live"), false);
  assert.equal(redactString("token ghp_ABCDEFGHIJKLMNOPQRSTUV1234567890").includes("ghp_"), false);
  assert.equal(redactString("aws AKIAIOSFODNN7EXAMPLE").includes("AKIA"), false);
  assert.equal(redactString("https://user:hunter2@db.example.com/x"), `https://${REDACTED}@db.example.com/x`);
  assert.equal(redactUrl("https://api.example.com/cb?access_token=abc123&x=1").includes("abc123"), false);

  const value = redactValue({ apiKey: "raw", nested: { password: "raw", ok: "fine" }, list: ["Bearer abcdef123456789"] });
  assert.equal(value.apiKey, REDACTED);
  assert.equal(value.nested.password, REDACTED);
  assert.equal(value.nested.ok, "fine");
  assert.equal(value.list[0], REDACTED);
  assert.equal(redactHeaders({ Authorization: "Bearer x", "X-Trace": "t1" })["Authorization"], REDACTED);
  assert.equal(redactHeaders({ Authorization: "Bearer x", "X-Trace": "t1" })["X-Trace"], "t1");
});

// V7. Execution gate tiers
test("execution gate: pre-M3 runs keep M2 behavior; vault runs need grants for high risk", () => {
  resetVaultState();
  const base = { runId: "run_pre_m3", projectId: "proj_a", providerId: "railway", category: "hosting", action: "create_project" };

  // Tier 2 skipped without a vault context.
  authorizeStepExecution(base);
  // Tier 1 kill switches bind EVERY run, vault-managed or not.
  setProviderKillSwitch("railway", true);
  assert.throws(
    () => authorizeStepExecution(base),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("provider_kill_switch_active")
  );
  resetKillSwitches();

  registerRunVaultContext({
    runId: "run_vault",
    organizationId: "org_a",
    projectId: "proj_a",
    environment: "production",
    machineIdentity: "svc://foundry/test",
  });
  const highRisk = { ...base, runId: "run_vault", action: "delete_project" };
  assert.throws(
    () => authorizeStepExecution(highRisk),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("approval_grant_missing")
  );

  const request = makeRequest({ runId: "run_vault", intendedAction: "delete_project", riskLevel: "high" });
  const approval = requestApproval(request);
  decideApproval(approval.approvalId, "approved", "founder");
  const grant = issueExecutionGrant(request, evaluatePolicy(request, { approvalId: approval.approvalId }));
  attachGrantToRun("run_vault", "railway", "delete_project", grant);
  authorizeStepExecution(highRisk); // consumes the single use
  assert.throws(() => authorizeStepExecution(highRisk), /grant/);

  // Forward grants never authorize rollback.
  const fwdRequest = makeRequest({ runId: "run_vault", intendedAction: "delete_environment", riskLevel: "high" });
  const fwdApproval = requestApproval(fwdRequest);
  decideApproval(fwdApproval.approvalId, "approved", "founder");
  const fwdGrant = issueExecutionGrant(fwdRequest, evaluatePolicy(fwdRequest, { approvalId: fwdApproval.approvalId }), "forward");
  attachGrantToRun("run_vault", "railway", "delete_environment", fwdGrant);
  assert.throws(
    () => authorizeStepExecution({ ...base, runId: "run_vault", action: "delete_environment", scope: "rollback" }),
    (error: unknown) => error instanceof VaultAccessError && error.reasonCodes.includes("approval_grant_missing")
  );
  resetVaultState();
});

// V8. Live engine proof: kill switch fails a real run through the vault gate
test("provider kill switch blocks a live run at the execution gate and clears cleanly", async () => {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  delete process.env.FOUNDRY_API_TOKEN;
  delete process.env.FOUNDRY_PRINCIPALS;
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, "vault-gate.json");
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  resetHealthState();
  resetVaultState();
  await mkdir(testDir, { recursive: true });
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });

  const draftSteps = [
    {
      id: "db",
      provider: "auto",
      category: "database",
      action: "provision_database",
      name: "Provision database",
      dependsOn: [],
      config: {},
      timeoutMs: 5000,
      retryLimit: 0,
    },
  ];
  const project = await createProject({ orgId: "org_local", name: "Vault Gate", prompt: "Vault gate proof" });
  await seedMockCredentials(project.id);
  const { plan } = await createPlanForProject({
    orgId: "org_local",
    projectId: project.id,
    prompt: project.prompt,
    draftPlan: { config: { name: "VG", hosting: "auto", repository: "vg-repo" }, budget: { maxSteps: 5, maxRuntimeMs: 120000 }, steps: draftSteps },
  });
  const chosenProvider = plan.steps[0].provider;
  setProviderKillSwitch(chosenProvider, true);

  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "vault-gate-1" });
  const start = Date.now();
  let terminal;
  while (Date.now() - start < 5000) {
    const snapshot = await getStoreSnapshot();
    const current = snapshot.runs.find((item) => item.id === run.id);
    if (current && ["completed", "failed", "cancelled", "rolled_back"].includes(current.status)) {
      terminal = current;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(terminal, "run did not reach terminal state");
  assert.equal(terminal.status, "failed");
  const snapshot = await getStoreSnapshot();
  const denied = snapshot.events.find((event) => event.runId === run.id && event.sanitizedMessage.includes("Vault gate denied"));
  assert.ok(denied, "expected a vault-gate denial event");
  assert.ok(denied.sanitizedMessage.includes("provider_kill_switch_active"));

  // Clearing the switch restores normal execution for a fresh run.
  resetKillSwitches();
  const rerun = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "vault-gate-2" });
  const restart = Date.now();
  let rerunTerminal;
  while (Date.now() - restart < 5000) {
    const current = (await getStoreSnapshot()).runs.find((item) => item.id === rerun.id);
    if (current && ["completed", "failed", "cancelled", "rolled_back"].includes(current.status)) {
      rerunTerminal = current;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(rerunTerminal?.status, "completed");
  resetVaultState();
});

// V9. Selection honors vault credential references when a scope is provided
test("selection with a vault scope answers credential availability from references", () => {
  resetHealthState();
  resetVaultState();
  const scope = { organizationId: "org_a", projectId: "proj_a", environment: "development" as const };
  registerSecretReference({
    organizationId: "org_a",
    projectId: "proj_a",
    environment: "development",
    providerId: "railway",
    displayName: "Railway (revoked)",
    capabilities: [],
    requiresApproval: false,
    status: "revoked",
  });
  registerSecretReference({
    organizationId: "org_a",
    projectId: "proj_a",
    environment: "development",
    providerId: "netlify",
    displayName: "Netlify token",
    capabilities: ["create_project"],
    requiresApproval: false,
  });
  assert.equal(findReferencesForProvider("railway", scope).length, 1);

  const decision = selectProvider({
    category: "hosting",
    action: "create_project",
    tenantPolicy: { tenantId: "t", allowedProviders: { hosting: ["railway", "netlify"] } },
    vaultScope: scope,
  });
  assert.equal(decision.providerId, "netlify");
  assert.ok(decision.rejected.some((r) => r.providerId === "railway" && r.reason.includes("no eligible credential reference")));
  resetVaultState();
});

// V10. Provider intelligence: history demotes, critical incidents disqualify
test("provider intelligence demotes unreliable providers and disqualifies critical incidents", () => {
  resetHealthState();
  resetVaultState();
  const policy = { tenantId: "t", allowedProviders: { hosting: ["railway", "netlify"] } };

  // No history: neutral prior keeps pre-M3 ordering (cheapest wins).
  assert.equal(selectProvider({ category: "hosting", action: "create_project", tenantPolicy: policy }).providerId, "railway");

  for (let i = 0; i < 20; i += 1) recordObservation({ providerId: "railway", kind: "execution_failure", capability: "hosting" });
  for (let i = 0; i < 20; i += 1) recordObservation({ providerId: "netlify", kind: "execution_success", capability: "hosting" });
  const informed = selectProvider({ category: "hosting", action: "create_project", tenantPolicy: policy });
  assert.equal(informed.providerId, "netlify");
  assert.ok(informed.intelligence && informed.intelligence.sampleSize > 0);

  const railwayScore = computeIntelligenceScore("railway", { capability: "hosting" });
  const netlifyScore = computeIntelligenceScore("netlify", { capability: "hosting" });
  assert.ok(netlifyScore.score > railwayScore.score);
  assert.ok(railwayScore.reasons.some((reason) => reason.includes("0% successful")));

  // An open critical incident disqualifies when an alternative exists.
  const incident = openIncident({ providerId: "netlify", severity: "critical", summary: "test outage" });
  const avoided = selectProvider({ category: "hosting", action: "create_project", tenantPolicy: policy });
  assert.equal(avoided.providerId, "railway");
  assert.ok(avoided.rejected.some((r) => r.providerId === "netlify" && r.reason === "open critical incident"));
  assert.equal(computeIntelligenceScore("netlify").disqualified, true);

  resolveIncident("netlify", incident.id, "provider status page green; probe passing");
  assert.equal(selectProvider({ category: "hosting", action: "create_project", tenantPolicy: policy }).providerId, "netlify");
  resetVaultState();
  resetHealthState();
});

// V11. Import guard: only lib/vault may import the trusted resolver
test("trusted resolver is never imported outside lib/vault", async () => {
  const roots = ["app", "components", "lib"];
  const offenders: string[] = [];
  async function scan(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        if (path.relative(process.cwd(), full).replace(/\\/g, "/") === "lib/vault") continue;
        await scan(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const source = await readFile(full, "utf8");
        if (/from\s+["'](@\/)?lib\/vault\/resolver["']/.test(source) || /["']\.\.?\/.*vault\/resolver["']/.test(source)) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    }
  }
  for (const root of roots) await scan(path.join(process.cwd(), root));
  assert.deepEqual(offenders, [], `resolver imported outside lib/vault: ${offenders.join(", ")}`);
});
