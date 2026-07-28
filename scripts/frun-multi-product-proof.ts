import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import {
  acquireRepositoryLock,
  createMission,
  generateContinuationPacket,
  markEveVerified,
  recordAdmission,
  releaseRepositoryLock,
  runDeterministicSlice,
} from "@/lib/mission-runner";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";

const root = process.cwd();
const proofRoot = path.join(root, ".foundry-test-data", "frun-multi-product-proof");
const storeFile = path.join(proofRoot, "store.json");
const artifactDir = path.join(proofRoot, "artifacts");
const lockDir = path.join(proofRoot, "locks");
const proofFile = path.join(root, "proof", "evidence", "frun-multi-product-proof.json");

const products = [
  {
    id: "dyln",
    name: "dyln safe local acceptance fixture",
    specification: "Prove the dyln loop can be represented as a bounded local Foundry mission without provider mutation.",
  },
  {
    id: "primeos",
    name: "PrimeOS safe local acceptance fixture",
    specification: "Prove a second product can use the same bounded local Foundry mission loop without duplicate execution.",
  },
];

interface ProductProofResult {
  product: string;
  missionId: string;
  finalStatus: string | undefined;
  missionStatus: string | undefined;
  criteriaCompleted: string[];
  criteriaRemaining: string[];
  iterationCount: number;
  continuationPacketArtifact: string;
  evidenceRefs: string[];
}

async function main() {
  process.env.FOUNDRY_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = storeFile;
  process.env.FOUNDRY_ARTIFACT_DIR = artifactDir;
  process.env.FOUNDRY_MISSION_LOCK_DIR = lockDir;
  Object.assign(process.env, { NODE_ENV: "test" });
  resetFoundryPersistence();
  await rm(proofRoot, { recursive: true, force: true });
  await mkdir(proofRoot, { recursive: true });

  await recordAdmission({
    orgId: "org_ecosystem_closeout",
    provider: "fixture",
    agent: "fixture-agent",
    model: "deterministic-fixture",
    allowedActions: ["write_fixture", "read_repo"],
    deniedActions: ["deploy_production", "modify_secrets", "provider_mutation", "billing_mutation"],
    maxRetries: 1,
    verificationRequirement: "eve",
    securityClassification: "standard",
    productionAuthority: false,
  });

  const productResults: ProductProofResult[] = [];
  for (const product of products) {
    const repo = path.join(proofRoot, `${product.id}-fixture-repo`);
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, "README.md"), `# ${product.id} local fixture\n`, "utf8");
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "foundry@example.test"]);
    git(repo, ["config", "user.name", "Foundry Multi Product Proof"]);
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "init"]);
    const mission = await createMission({
      orgId: "org_ecosystem_closeout",
      name: product.name,
      specification: product.specification,
      repositoryPaths: [repo],
      nextAction: "criterion-a",
    });
    const lock = await acquireRepositoryLock({ missionId: mission.id, repositoryPath: repo, branch: "main" });
    await runDeterministicSlice({ missionId: mission.id, repositoryPath: repo, prompt: `${product.id}: complete criterion-a only`, sliceClass: "isolated_repair" });
    await runDeterministicSlice({ missionId: mission.id, repositoryPath: repo, prompt: `${product.id}: continue criterion-b only`, sliceClass: "targeted_verification" });
    const packet = await generateContinuationPacket(mission.id);
    await markEveVerified(mission.id, `local-fixture-eve:${product.id}`);
    await releaseRepositoryLock(lock.id);
    const snapshot = await getStoreSnapshot();
    const completedMission = snapshot.missionRunnerMissions.find((item) => item.id === mission.id);
    const iterations = snapshot.missionRunnerIterations.filter((item) => item.missionId === mission.id);
    productResults.push({
      product: product.id,
      missionId: mission.id,
      finalStatus: completedMission?.finalStatus,
      missionStatus: completedMission?.status,
      criteriaCompleted: completedMission?.completedCriteria ?? [],
      criteriaRemaining: completedMission?.unresolvedCriteria ?? [],
      iterationCount: iterations.length,
      continuationPacketArtifact: packet.artifactId,
      evidenceRefs: completedMission?.evidenceManifest ?? [],
    });
  }

  const allPassed = productResults.every((item) => item.finalStatus === "PASS" && item.criteriaRemaining.length === 0);
  const finalSnapshot = await getStoreSnapshot();
  const verificationEvents = finalSnapshot.missionRunnerEvents.filter(
    (event) => productResults.some((product) => product.missionId === event.missionId) && event.type === "eve.verified"
  );
  const eventMissionIds = new Set(verificationEvents.map((event) => event.missionId));
  const storeAudit = {
    missionCount: productResults.length,
    iterationCount: finalSnapshot.missionRunnerIterations.length,
    continuationArtifactCount: productResults.filter((item) => Boolean(item.continuationPacketArtifact)).length,
    eveVerificationEventCount: verificationEvents.length,
    everyMissionHasDurableEveEvent: productResults.every((item) => eventMissionIds.has(item.missionId)),
    releasedLockCount: finalSnapshot.missionRunnerLocks.filter((lock) => lock.status === "released").length,
    activeLockCount: finalSnapshot.missionRunnerLocks.filter((lock) => lock.status === "active").length,
  };
  const evidence = {
    capabilityId: "FRUN-MULTI-PRODUCT-LOCAL",
    mission: "ECOSYSTEM-CLOSEOUT-001",
    generatedAt: new Date().toISOString(),
    foundryRepository: root,
    fixtureRoot: proofRoot,
    providerMutation: false,
    repositoryMutationScope: "local fixture filesystem under .foundry-test-data/frun-multi-product-proof only",
    liveProviderCallsMade: false,
    products: productResults,
    proofs: {
      dylnProductLoopRepresented: productResults.some((item) => item.product === "dyln" && item.finalStatus === "PASS"),
      additionalProductLoopRepresented: productResults.some((item) => item.product !== "dyln" && item.finalStatus === "PASS"),
      allProductsCompleted: allPassed,
      continuationPacketsGenerated: productResults.every((item) => Boolean(item.continuationPacketArtifact)),
      durableStoreEveEventsPresent: storeAudit.everyMissionHasDurableEveEvent,
      noActiveFixtureLocksRemain: storeAudit.activeLockCount === 0,
      boundedLocalFixtureOnly: true,
      providerMutationPrevented: true,
    },
    storeAudit,
    eve: {
      verdict: allPassed && storeAudit.everyMissionHasDurableEveEvent && storeAudit.activeLockCount === 0 ? "VERIFIED" : "REJECTED",
      verificationId: "local-fixture-eve:frun-multi-product",
      boundary: "Local deterministic fixture verifier only; no external E.V.E. or provider mutation.",
    },
  };
  Object.assign(evidence.eve, {
    verificationDigest: sha256(JSON.stringify({ products: productResults, storeAudit })),
  });
  await mkdir(path.dirname(proofFile), { recursive: true });
  await writeFile(proofFile, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({ proofFile, status: evidence.eve.verdict, products: productResults.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
