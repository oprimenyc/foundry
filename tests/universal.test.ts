import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { universalRegistry } from "@/lib/foundry/universal/catalog";
import { PROVIDER_CATEGORIES, NoEligibleProviderError, type TenantPolicy } from "@/lib/foundry/universal/types";
import { selectProvider, selectFailover } from "@/lib/foundry/universal/selection";
import { credentialStatusFor, credentialReferenceFor, assertNoPlaintextSecrets } from "@/lib/foundry/universal/credentials";
import { recordOutcome, healthScore, probeProvider, resetHealthState } from "@/lib/foundry/universal/health";
import { rankByCost } from "@/lib/foundry/universal/cost";
import { verifyProvider, verifySelectionDecision } from "@/lib/foundry/universal/verification";
import { UnknownProviderError } from "@/lib/foundry/registry";
import { validateDraftPlan } from "@/lib/foundry/plan";
import { createProject, createPlanForProject, createRunForProject, seedMockCredentials } from "@/lib/foundry/service";
import { requestRollback } from "@/lib/foundry/execution";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";

const testDir = path.join(process.cwd(), ".foundry-test-data");

async function resetEnv(name: string) {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  delete process.env.FOUNDRY_API_TOKEN;
  delete process.env.FOUNDRY_PRINCIPALS;
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, `${name}.json`);
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  resetHealthState();
  await mkdir(testDir, { recursive: true });
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

// 1. Provider registry
test("universal registry covers every category and fails closed on unknown ids", () => {
  for (const category of PROVIDER_CATEGORIES) {
    assert.ok(universalRegistry.list(category).length > 0, `no providers registered for ${category}`);
  }
  assert.throws(() => universalRegistry.get("nonexistent-cloud"), UnknownProviderError);
  for (const manifest of universalRegistry.manifests()) {
    assert.ok(manifest.id && manifest.name && manifest.category, `${manifest.id} incomplete manifest`);
    assert.ok(manifest.supportedCapabilities.length > 0, `${manifest.id} declares no capabilities`);
    assert.ok(manifest.documentationUrl.startsWith("http"), `${manifest.id} missing documentation URL`);
    assert.ok(["live", "mock", "unavailable"].includes(manifest.runtimeStatus));
  }
});

// 2. Provider selection
test("selection engine picks an eligible provider deterministically and records reasons", () => {
  resetHealthState();
  const first = selectProvider({ category: "hosting", action: "create_project" });
  const second = selectProvider({ category: "hosting", action: "create_project" });
  assert.equal(first.providerId, second.providerId);
  assert.ok(first.reasons.length > 0);
  assert.ok(universalRegistry.list("hosting").includes(first.providerId));
});

// 3. Capability routing
test("capability routing: only providers declaring the action are eligible; auto plans resolve by category", () => {
  resetHealthState();
  const dnsCertProviders = universalRegistry.findByCapability("dns", "issue_certificate").map((p) => p.provider);
  assert.ok(dnsCertProviders.length > 0);
  const dnsAllProviders = universalRegistry.list("dns");
  assert.ok(dnsAllProviders.length >= dnsCertProviders.length);

  const result = validateDraftPlan({
    config: { name: "Auto", hosting: "auto", repository: "auto-repo" },
    budget: { maxSteps: 5, maxRuntimeMs: 120000 },
    steps: [
      {
        id: "repo",
        provider: "auto",
        category: "repository",
        action: "create_repository",
        name: "Create repository",
        dependsOn: [],
        config: { repositoryName: "auto-repo" },
        timeoutMs: 5000,
        retryLimit: 0,
      },
    ],
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.notEqual(result.plan.steps[0].provider, "auto");
    assert.ok(universalRegistry.list("repository").includes(result.plan.steps[0].provider));
    assert.equal(result.plan.steps[0].config.selectedBy, "foundry-selection-engine@1");
  }

  const bad = validateDraftPlan({
    config: { name: "Bad", hosting: "auto", repository: "bad-repo" },
    budget: { maxSteps: 5, maxRuntimeMs: 120000 },
    steps: [
      {
        id: "impossible",
        provider: "auto",
        category: "hosting",
        action: "not_a_real_action",
        name: "Impossible",
        dependsOn: [],
        config: {},
        timeoutMs: 5000,
        retryLimit: 0,
      },
    ],
  });
  assert.equal(bad.ok, false);
});

// 4. Credential resolution
test("credential registry exposes references only — never secret values", () => {
  const github = universalRegistry.get("github").manifest;
  const status = credentialStatusFor(github);
  assert.equal(status.providerId, "github");
  for (const reference of [...status.presentReferences, ...status.missingReferences]) {
    assert.match(reference, /^[A-Z0-9_]+$/, "credential references must be env-var NAMES");
  }
  assert.equal(credentialReferenceFor(github), "secret:github/execution");
  assert.throws(() => assertNoPlaintextSecrets({ apiToken: "sk_live_plaintext" }), /secret reference/);
  assertNoPlaintextSecrets({ apiToken: "secret:github/execution", projectName: "ok" });
});

// 5. Rollback through a catalog provider chosen by category
test("rollback compensates steps executed by a selection-chosen provider", async () => {
  await resetEnv("universal-rollback");
  const project = await createProject({ orgId: "org_local", name: "Universal RB", prompt: "Launch universal rollback app" });
  await seedMockCredentials(project.id);
  const decision = selectProvider({ category: "database", action: "provision_database" });
  const { plan } = await createPlanForProject({
    orgId: "org_local",
    projectId: project.id,
    prompt: project.prompt,
    draftPlan: {
      config: { name: "RB", hosting: "auto", repository: "rb-repo" },
      budget: { maxSteps: 5, maxRuntimeMs: 120000 },
      steps: [
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
          rollbackAction: "provision_database",
        },
      ],
    },
  });
  assert.equal(plan.status, "validated");
  assert.equal(plan.steps[0].provider, decision.providerId);
  const run = await createRunForProject({ orgId: "org_local", projectId: project.id, planId: plan.id, idempotencyKey: "u-rb" });
  let terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "completed");
  await requestRollback(run.id);
  terminal = await waitForTerminal(run.id);
  assert.equal(terminal.status, "rolled_back");
  const snapshot = await getStoreSnapshot();
  assert.equal(snapshot.steps.filter((s) => s.runId === run.id && s.status === "rolled_back").length, 1);
});

// 6. Health scoring
test("health scoring: failures lower the rolling score and probes record outcomes", async () => {
  resetHealthState();
  assert.equal(healthScore("railway"), 1);
  for (let i = 0; i < 10; i += 1) recordOutcome("railway", false);
  assert.equal(healthScore("railway"), 0);
  recordOutcome("railway", true);
  assert.ok(healthScore("railway") > 0 && healthScore("railway") < 1);

  const probe = await probeProvider(universalRegistry.get("railway"));
  assert.equal(probe.providerId, "railway");
  assert.equal(typeof probe.healthy, "boolean");
  assert.ok(probe.detail.length > 0);
  resetHealthState();
});

// 6b. Health-driven selection
test("selection avoids providers below the health floor when alternatives exist", () => {
  resetHealthState();
  const policy: TenantPolicy = { tenantId: "t", allowedProviders: { hosting: ["railway", "netlify"] } };
  const initial = selectProvider({ category: "hosting", action: "create_project", tenantPolicy: policy });
  assert.equal(initial.providerId, "railway"); // cheaper of the two
  for (let i = 0; i < 10; i += 1) recordOutcome("railway", false);
  const afterFailures = selectProvider({ category: "hosting", action: "create_project", tenantPolicy: policy });
  assert.equal(afterFailures.providerId, "netlify");
  assert.ok(afterFailures.rejected.some((r) => r.providerId === "railway" && r.reason.includes("health score")));
  resetHealthState();
});

// 7. Provider failover
test("failover selection excludes the failed provider and fails closed when exhausted", () => {
  resetHealthState();
  const policy: TenantPolicy = { tenantId: "t", allowedProviders: { hosting: ["railway", "netlify"] } };
  const first = selectProvider({ category: "hosting", action: "create_project", tenantPolicy: policy });
  const second = selectFailover({ category: "hosting", action: "create_project", tenantPolicy: policy }, first.providerId);
  assert.notEqual(second.providerId, first.providerId);
  assert.throws(
    () =>
      selectProvider({
        category: "hosting",
        action: "create_project",
        tenantPolicy: policy,
        excludeProviders: ["railway", "netlify"],
      }),
    NoEligibleProviderError
  );
});

// 8. Cost selection
test("cost engine ranks cheapest-first and selection prefers cheaper providers at equal health", () => {
  resetHealthState();
  const ranked = rankByCost([universalRegistry.get("railway").manifest, universalRegistry.get("netlify").manifest]);
  assert.equal(ranked[0].providerId, "railway");
  const decision = selectProvider({
    category: "hosting",
    action: "create_project",
    tenantPolicy: { tenantId: "t", allowedProviders: { hosting: ["railway", "netlify"] } },
  });
  assert.equal(decision.providerId, "railway");
  // Tenant cost cap rejects providers above the monthly floor cap.
  const capped = selectProvider({
    category: "hosting",
    action: "create_project",
    tenantPolicy: { tenantId: "t", allowedProviders: { hosting: ["railway", "netlify"] }, maxMonthlyCostUsd: 10 },
  });
  assert.equal(capped.providerId, "railway");
  assert.ok(capped.rejected.some((r) => r.providerId === "netlify" && r.reason.includes("cap")));
});

// 9. Tenant preference / policy
test("tenant policy: preferred wins, blocked never selected, allowed list is exclusive", () => {
  resetHealthState();
  const preferred = selectProvider({
    category: "hosting",
    action: "create_project",
    tenantPolicy: { tenantId: "t", preferredProviders: { hosting: "netlify" } },
  });
  assert.equal(preferred.providerId, "netlify");

  const blocked = selectProvider({
    category: "hosting",
    action: "create_project",
    tenantPolicy: { tenantId: "t", blockedProviders: ["netlify"], preferredProviders: { hosting: "netlify" } },
  });
  assert.notEqual(blocked.providerId, "netlify");
  assert.ok(blocked.rejected.some((r) => r.providerId === "netlify" && r.reason.includes("blocked")));

  assert.throws(
    () =>
      selectProvider({
        category: "hosting",
        action: "create_project",
        tenantPolicy: { tenantId: "t", allowedProviders: { hosting: ["netlify"] }, blockedProviders: ["netlify"] },
      }),
    NoEligibleProviderError
  );
});

// 10. Provider verification
test("provider verification engine verifies providers and selection decisions independently", async () => {
  resetHealthState();
  const verification = await verifyProvider("railway");
  assert.equal(verification.providerId, "railway");
  assert.equal(verification.ok, true);
  assert.equal(verification.verifierVersion, "foundry-provider-verifier@1");

  const decision = selectProvider({ category: "hosting", action: "create_project" });
  const check = verifySelectionDecision(decision);
  assert.equal(check.ok, true);

  const stale = verifySelectionDecision({ ...decision, action: "not_a_real_action" });
  assert.equal(stale.ok, false);
  const gone = verifySelectionDecision({ ...decision, providerId: "vanished-cloud" });
  assert.equal(gone.ok, false);
});

// Mock lockout carries through the universal layer.
test("catalog mock providers fail closed in production", async () => {
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    const provider = universalRegistry.get("railway");
    await assert.rejects(
      provider.execute("create_project", { runId: "r", stepId: "s", projectId: "p", config: {}, providerReferences: {} }),
      /disabled in production/
    );
    assert.throws(() => selectProvider({ category: "crm", action: "create_crm_contact" }), NoEligibleProviderError);
  } finally {
    Object.assign(process.env, { NODE_ENV: "test" });
  }
});

// NO HARDCODING guard: core execution files must not branch on vendor names.
test("core execution modules contain no vendor-name branching", async () => {
  const { readFile } = await import("fs/promises");
  const core = ["lib/foundry/execution.ts", "lib/foundry/plan.ts", "lib/foundry/verification.ts", "lib/orchestration/saga.ts"];
  const vendorPattern = /"(github|vercel|railway|fly-io|cloudflare|resend|signalwire|stripe|supabase|netlify)"/;
  for (const file of core) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    const codeOnly = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    assert.equal(vendorPattern.test(codeOnly), false, `${file} contains a hardcoded vendor name`);
  }
});
