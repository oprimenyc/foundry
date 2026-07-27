import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";
import {
  acquireRepositoryLock,
  assertProviderRouteAdmitted,
  BoundaryAgentAdapter,
  claudeCodeAdapter,
  classifyFailure,
  classifyHumanGate,
  codexCliAdapter,
  createMission,
  generateContinuationPacket,
  missionControlReport,
  openRouterBoundaryAdapter,
  ollamaBoundaryAdapter,
  reconcileTakeover,
  recordAdmission,
  releaseRepositoryLock,
  routeAfterFailure,
  runDeterministicSlice,
  runProcess,
  selectChecks,
  transitionIteration,
  transitionMission,
  createIteration,
} from "@/lib/mission-runner";
import { getStoreSnapshot, resetFoundryPersistence, updateRecords } from "@/lib/foundry/store";

const testDir = path.join(process.cwd(), ".foundry-test-data", "mission-runner");

async function resetEnv(name: string) {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, `${name}.json`);
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(testDir, `${name}-artifacts`);
  process.env.FOUNDRY_MISSION_LOCK_DIR = path.join(testDir, `${name}-locks`);
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });
  await rm(process.env.FOUNDRY_ARTIFACT_DIR, { recursive: true, force: true });
  await rm(process.env.FOUNDRY_MISSION_LOCK_DIR, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });
}

async function fixtureRepo(name: string) {
  const repo = path.join(testDir, name);
  await rm(repo, { recursive: true, force: true });
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "foundry@example.test"]);
  git(repo, ["config", "user.name", "Foundry Test"]);
  await writeFile(path.join(repo, "README.md"), "# fixture\n", "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

test("mission core validates state transitions and keeps append-only events", async () => {
  await resetEnv("core");
  const repo = await fixtureRepo("core-repo");
  const mission = await createMission({
    orgId: "org_frun",
    name: "FRUN core",
    specification: "durable mission core",
    repositoryPaths: [repo],
    nextAction: "prepare",
  });
  await transitionMission(mission.id, "PREPARING");
  await transitionMission(mission.id, "RUNNING");
  await assert.rejects(() => transitionMission(mission.id, "QUEUED"), /Invalid mission transition/);
  const iteration = await createIteration({
    missionId: mission.id,
    sliceClass: "reconnaissance",
    agent: "fixture-agent",
    provider: "fixture",
    model: "deterministic",
  });
  await transitionIteration(iteration.id, "PROMPTED");
  await transitionIteration(iteration.id, "EXECUTING");
  await assert.rejects(() => transitionIteration(iteration.id, "CREATED"), /Invalid iteration transition/);
  const snapshot = await getStoreSnapshot();
  assert.equal(snapshot.missionRunnerMissions.length, 1);
  assert.equal(snapshot.missionRunnerIterations.length, 1);
  assert.deepEqual(
    snapshot.missionRunnerEvents.map((event) => event.sequence),
    snapshot.missionRunnerEvents.map((event) => event.sequence).sort((a, b) => a - b)
  );
  resetFoundryPersistence();
  const reloaded = await getStoreSnapshot();
  assert.equal(reloaded.missionRunnerMissions[0].status, "RUNNING");
});

test("exclusive lock rejects second mutator, allows read-only takeover, and recovers stale lock", async () => {
  await resetEnv("locks");
  const repo = await fixtureRepo("lock-repo");
  const mission = await createMission({ orgId: "org_frun", name: "locks", specification: "locks", repositoryPaths: [repo] });
  const lock = await acquireRepositoryLock({ missionId: mission.id, repositoryPath: repo, branch: "main" });
  await assert.rejects(() => acquireRepositoryLock({ missionId: mission.id, repositoryPath: repo, branch: "main" }), /lock already active/);
  const readOnly = await acquireRepositoryLock({ missionId: mission.id, repositoryPath: repo, branch: "main", readOnly: true });
  assert.equal(readOnly.status, "recovered");
  await updateRecords("missionRunnerLocks", (item) => item.id === lock.id, (item) => ({
    ...item,
    processId: 999999,
    heartbeatAt: "2000-01-01T00:00:00.000Z",
  }));
  const recovered = await acquireRepositoryLock({ missionId: mission.id, repositoryPath: repo, branch: "main", staleAfterMs: 1 });
  assert.equal(recovered.status, "active");
  await releaseRepositoryLock(recovered.id);
});

test("failure classifier and continuity router handle deterministic limit fixtures", async () => {
  const cases: Array<[string, string, number | null | undefined, string | null | undefined]> = [
    ["SUCCESS", "done", 0, undefined],
    ["SESSION_LIMIT", "hit your session limit; resets 5pm America/New_York", 1, undefined],
    ["CONTEXT_LIMIT", "context window is full", 1, undefined],
    ["RATE_LIMIT", "429 rate limit retry-after: 12", 1, undefined],
    ["CREDIT_LIMIT", "insufficient credits", 1, undefined],
    ["PROVIDER_OUTAGE", "service unavailable overloaded", 1, undefined],
    ["AUTH_FAILURE", "not authenticated invalid api key", 1, undefined],
    ["MODEL_UNAVAILABLE", "model unavailable", 1, undefined],
    ["TOOL_FAILURE", "tool_error", 1, undefined],
    ["AGENT_STALL", "", undefined, undefined],
    ["PROCESS_CRASH", "segfault", 1, undefined],
    ["USER_CANCELLED", "user cancelled", 1, undefined],
    ["UNKNOWN_FAILURE", "", undefined, undefined],
  ];
  for (const [expected, stderr, exitCode, signal] of cases) {
    const result = classifyFailure({
      exitCode,
      signal,
      stderr,
      noOutputMs: expected === "AGENT_STALL" ? 20_000 : 0,
      timeoutMs: expected === "AGENT_STALL" ? 10_000 : 60_000,
    });
    assert.equal(result.reason, expected);
  }
  assert.equal(
    routeAfterFailure({
      reason: "SESSION_LIMIT",
      repeatedCount: 0,
      exhaustedProviders: [],
      currentProvider: "anthropic",
      eligibleRoutes: [{ provider: "openai", agent: "codex", model: "policy-model" }],
    }).missionState,
    "RECOVERING"
  );
  assert.equal(
    routeAfterFailure({
      reason: "CREDIT_LIMIT",
      repeatedCount: 0,
      exhaustedProviders: [],
      currentProvider: "anthropic",
      eligibleRoutes: [{ provider: "openai", agent: "codex", model: "policy-model" }],
    }).disableProvider,
    "anthropic"
  );
  assert.equal(
    routeAfterFailure({
      reason: "AUTH_FAILURE",
      repeatedCount: 0,
      exhaustedProviders: [],
      currentProvider: "anthropic",
      eligibleRoutes: [],
    }).missionState,
    "HUMAN_GATE"
  );
});

test("admission policy prevents fallback authority broadening", async () => {
  await resetEnv("authority");
  await recordAdmission({
    orgId: "org_frun",
    provider: "openai",
    agent: "codex",
    model: "policy-model",
    allowedActions: ["read_repo", "write_fixture"],
    deniedActions: ["deploy_production", "modify_secrets"],
    maxRetries: 1,
    verificationRequirement: "eve",
    securityClassification: "standard",
    productionAuthority: false,
  });
  const snapshot = await getStoreSnapshot();
  assertProviderRouteAdmitted(snapshot.missionRunnerAdmissions, {
    orgId: "org_frun",
    provider: "openai",
    agent: "codex",
    model: "policy-model",
    action: "write_fixture",
  });
  assert.throws(
    () =>
      assertProviderRouteAdmitted(snapshot.missionRunnerAdmissions, {
        orgId: "org_frun",
        provider: "openai",
        agent: "codex",
        model: "policy-model",
        action: "deploy_production",
        production: true,
      }),
    /not admitted|production authority/
  );
  assert.equal(classifyHumanGate("MFA"), true);
  assert.equal(classifyHumanGate("FAILED_TEST"), false);
});

test("continuation, takeover, no-repeat slice, process capture, and mission control work", async () => {
  await resetEnv("runtime");
  const repo = await fixtureRepo("runtime-repo");
  const mission = await createMission({
    orgId: "org_frun",
    name: "runtime",
    specification: "criterion-a then criterion-b",
    repositoryPaths: [repo],
    nextAction: "criterion-a",
  });
  await acquireRepositoryLock({ missionId: mission.id, repositoryPath: repo, branch: "main" });
  await runDeterministicSlice({ missionId: mission.id, repositoryPath: repo, prompt: "do criterion a", sliceClass: "isolated_repair" });
  const first = await readFixture(repo);
  assert.match(first, /criterion-a:complete/);
  assert.doesNotMatch(first, /criterion-b:complete/);
  const packet = await generateContinuationPacket(mission.id);
  assert.equal(packet.packet.completedCriteria.includes("criterion-a"), true);
  const head = git(repo, ["rev-parse", "HEAD"]);
  const blocked = await reconcileTakeover({
    missionId: mission.id,
    repositoryPath: repo,
    expectedBranch: "main",
    expectedHead: head,
    dirtyStateAllowed: false,
    currentTests: ["not-yet-run"],
  });
  assert.equal(blocked.writeAuthority, false);
  const allowed = await reconcileTakeover({
    missionId: mission.id,
    repositoryPath: repo,
    expectedBranch: "main",
    expectedHead: head,
    dirtyStateAllowed: true,
    currentTests: ["fixture checked"],
  });
  assert.deepEqual(allowed.states.at(-1), "EXECUTION_RESUMED");
  await runDeterministicSlice({ missionId: mission.id, repositoryPath: repo, prompt: "continue criterion b", sliceClass: "targeted_verification" });
  const second = await readFixture(repo);
  assert.equal((second.match(/criterion-a:complete/g) ?? []).length, 1);
  assert.match(second, /criterion-b:complete/);
  const proc = await runProcess({
    missionId: mission.id,
    iterationId: (await getStoreSnapshot()).missionRunnerIterations.at(-1)?.id ?? "iter",
    command: process.execPath,
    args: ["-e", "console.log('frun-process-proof')"],
    cwd: repo,
    timeoutMs: 5000,
  });
  assert.equal(proc.record.exitCode, 0);
  assert.match(proc.stdout, /frun-process-proof/);
  const checks = selectChecks({
    changedFiles: ["docs/FRUN.md"],
    checkpointClosing: false,
    finalCertification: false,
    priorFullSuiteCommit: head,
    currentCommit: head,
  });
  assert.equal(checks.mode, "targeted");
  const report = await missionControlReport("org_frun");
  assert.equal(report.length, 1);
  assert.equal(report[0].evidenceStatus, "present");
});

test("agent adapter contracts require configured models and safe boundary admission", () => {
  assert.deepEqual(codexCliAdapter.buildCommand({ model: "policy-model", sandbox: "workspace-write" }).args.slice(0, 3), [
    "exec",
    "--model",
    "policy-model",
  ]);
  assert.equal(claudeCodeAdapter.validateConfig({ model: "policy-model" }).ok, true);
  assert.equal(new BoundaryAgentAdapter("openrouter", "openrouter-boundary", "configured").validateConfig({ endpoint: "", model: "x" }).ok, false);
  assert.equal(openRouterBoundaryAdapter.validateConfig({ endpoint: "https://openrouter.ai/api/v1", model: "policy-model", productionAuthority: false }).ok, true);
  assert.equal(ollamaBoundaryAdapter.validateConfig({ endpoint: "http://127.0.0.1:11434", model: "local-model", productionAuthority: true }).ok, false);
});

async function readFixture(repo: string) {
  return await import("fs/promises").then((fs) => fs.readFile(path.join(repo, "FRUN_FIXTURE.txt"), "utf8"));
}
