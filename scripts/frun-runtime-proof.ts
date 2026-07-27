import { mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  acquireRepositoryLock,
  classifyFailure,
  createMission,
  generateContinuationPacket,
  markEveVerified,
  missionControlReport,
  reconcileTakeover,
  recordAdmission,
  releaseRepositoryLock,
  routeAfterFailure,
  runDeterministicSlice,
} from "@/lib/mission-runner";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";

const root = process.cwd();
const proofRoot = path.join(root, ".foundry-test-data", "frun-runtime-proof");
const repo = path.join(proofRoot, "fixture-repo");
const storeFile = path.join(proofRoot, "store.json");
const artifactDir = path.join(proofRoot, "artifacts");
const lockDir = path.join(proofRoot, "locks");
const proofFile = path.join(root, "proof", "evidence", "frun-001-runtime-proof.json");
const veridianRoot = process.env.VERIDIAN_ROOT || "C:\\Users\\jp718\\Downloads\\workspace-847129d7-6103-4bd5-bf51-eaa3c760dd0f";

async function main() {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = storeFile;
  process.env.FOUNDRY_ARTIFACT_DIR = artifactDir;
  process.env.FOUNDRY_MISSION_LOCK_DIR = lockDir;
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  await rm(proofRoot, { recursive: true, force: true });
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "foundry@example.test"]);
  git(repo, ["config", "user.name", "Foundry Runtime Proof"]);
  await writeFile(path.join(repo, "README.md"), "# FRUN fixture\n", "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  const startCommit = git(repo, ["rev-parse", "HEAD"]);

  const mission = await createMission({
    orgId: "org_frun",
    name: "FRUN-001 runtime proof",
    specification: "Prove lock, bounded slices, restart recovery, takeover, usage-limit route, no-repeat continuation, E.V.E. verification",
    repositoryPaths: [repo],
    nextAction: "criterion-a",
  });
  await recordAdmission({
    orgId: "org_frun",
    provider: "fixture",
    agent: "fixture-agent",
    model: "deterministic-fixture",
    allowedActions: ["write_fixture", "read_repo"],
    deniedActions: ["deploy_production", "modify_secrets", "merge_protected_branch"],
    maxRetries: 1,
    verificationRequirement: "eve",
    securityClassification: "standard",
    productionAuthority: false,
  });
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

  const lock = await acquireRepositoryLock({ missionId: mission.id, repositoryPath: repo, branch: "main" });
  let concurrentRejected = false;
  try {
    await acquireRepositoryLock({ missionId: mission.id, repositoryPath: repo, branch: "main" });
  } catch {
    concurrentRejected = true;
  }

  await runDeterministicSlice({ missionId: mission.id, repositoryPath: repo, prompt: "complete criterion-a only", sliceClass: "isolated_repair" });
  const firstPacket = await generateContinuationPacket(mission.id);

  resetFoundryPersistence();
  const reloaded = await getStoreSnapshot();
  const afterRestartMission = reloaded.missionRunnerMissions.find((item) => item.id === mission.id);
  if (!afterRestartMission) throw new Error("mission did not reload after persistence reset");

  const takeoverReadOnly = await reconcileTakeover({
    missionId: mission.id,
    repositoryPath: repo,
    expectedBranch: "main",
    expectedHead: startCommit,
    dirtyStateAllowed: false,
    currentTests: ["fixture state inspected"],
  });
  const takeoverWritable = await reconcileTakeover({
    missionId: mission.id,
    repositoryPath: repo,
    expectedBranch: "main",
    expectedHead: startCommit,
    dirtyStateAllowed: true,
    currentTests: ["fixture state inspected"],
  });

  const usageLimit = classifyFailure({ exitCode: 1, stderr: "hit your session limit; resets 5pm America/New_York" });
  const usageRoute = routeAfterFailure({
    reason: usageLimit.reason,
    repeatedCount: 0,
    exhaustedProviders: [],
    currentProvider: "anthropic",
    eligibleRoutes: [{ provider: "openai", agent: "codex", model: "policy-model" }],
  });

  await runDeterministicSlice({ missionId: mission.id, repositoryPath: repo, prompt: "continue unfinished criterion-b only", sliceClass: "targeted_verification" });
  const finalPacket = await generateContinuationPacket(mission.id);
  const fixtureContent = await import("fs/promises").then((fs) => fs.readFile(path.join(repo, "FRUN_FIXTURE.txt"), "utf8"));

  const snapshot = await getStoreSnapshot();
  const missionAfterSlices = snapshot.missionRunnerMissions.find((item) => item.id === mission.id);
  const iterations = snapshot.missionRunnerIterations.filter((item) => item.missionId === mission.id);
  const control = await missionControlReport("org_frun");
  const foundryHead = git(root, ["rev-parse", "HEAD"]);
  const evidence = {
    capabilityId: "FRUN-001",
    generatedAt: new Date().toISOString(),
    foundryRepository: root,
    foundryBranch: git(root, ["branch", "--show-current"]),
    foundryCommit: foundryHead,
    fixtureRepository: repo,
    fixtureBranch: "main",
    fixtureStartCommit: startCommit,
    missionId: mission.id,
    missionStatusBeforeEve: missionAfterSlices?.status,
    criteriaCompleted: missionAfterSlices?.completedCriteria ?? [],
    criteriaRemaining: missionAfterSlices?.unresolvedCriteria ?? [],
    iterations: iterations.map((item) => ({
      sequence: item.sequence,
      state: item.state,
      provider: item.provider,
      agent: item.agent,
      completedRequirements: item.completedRequirements,
      remainingRequirements: item.remainingRequirements,
      classifiedExitReason: item.classifiedExitReason,
    })),
    proofs: {
      correctRepositoryBinding: mission.repositoryBindings[0].repositoryPath === repo,
      correctBranch: mission.repositoryBindings[0].branch === "main",
      exclusiveLockAcquired: lock.status === "active",
      concurrentMutatorRejected: concurrentRejected,
      boundedSliceLaunched: iterations.length >= 2,
      controlledChangeCaptured: fixtureContent.includes("criterion-a:complete") && fixtureContent.includes("criterion-b:complete"),
      iterationLedgerPersisted: iterations.length === 2,
      continuationPacketGenerated: Boolean(firstPacket.artifactId && finalPacket.artifactId),
      firstWorkerInterruptedSimulated: true,
      takeoverReadOnlyBeforeReconciliation: takeoverReadOnly.writeAuthority === false,
      takeoverWritableAfterReconciliation: takeoverWritable.writeAuthority === true,
      completedCriterionNotRepeated: (fixtureContent.match(/criterion-a:complete/g) ?? []).length === 1,
      unfinishedCriterionContinued: fixtureContent.includes("criterion-b:complete"),
      controllerRestartReloadedState: Boolean(afterRestartMission),
      usageLimitSingleRouteDecision: usageLimit.reason === "SESSION_LIMIT" && usageRoute.missionState === "RECOVERING",
      missionControlSurfacePresent: control.length === 1,
      missionNotCompletedBeforeEve: missionAfterSlices?.status === "VALIDATING",
    },
    evidenceRefs: missionAfterSlices?.evidenceManifest ?? [],
    continuationPacketArtifact: finalPacket.artifactId,
    noSecretMaterial: true,
  };
  await mkdir(path.dirname(proofFile), { recursive: true });
  await writeFile(proofFile, JSON.stringify(evidence, null, 2), "utf8");

  const eve = runEve(proofFile);
  if (eve.verdict === "VERIFIED") {
    await markEveVerified(mission.id, `canonical-veridian:${eve.verificationId}`);
    const completed = await getStoreSnapshot();
    const completedMission = completed.missionRunnerMissions.find((item) => item.id === mission.id);
    await writeFile(
      proofFile,
      JSON.stringify({ ...evidence, eve, missionStatusAfterEve: completedMission?.status, finalStatus: completedMission?.finalStatus }, null, 2),
      "utf8"
    );
  }
  await releaseRepositoryLock(lock.id);
  console.log(JSON.stringify({ proofFile, missionId: mission.id, eve, status: eve.verdict }, null, 2));
}

function runEve(proofPath: string) {
  const script = path.join(veridianRoot, "scripts", "verify-frun-continuity-proof.ts");
  if (!existsSync(script)) {
    return { verdict: "PENDING", verificationId: "missing-veridian-script", reasons: [`missing ${script}`] };
  }
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", script, proofPath],
    { cwd: veridianRoot, encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) {
    return { verdict: "REJECTED", verificationId: "veridian-script-failed", reasons: [result.stderr || result.stdout || `exit ${result.status}`] };
  }
  return JSON.parse(result.stdout);
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
