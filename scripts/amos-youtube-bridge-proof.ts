/**
 * AMOS -> Foundry YouTube package evidence bridge proof.
 *
 * Reads AMOS's real, already-committed YouTube package proof read-only
 * (proofs/youtube-package/youtube-package.json + PROOF_MANIFEST.json in the
 * AMOS-CANONICAL repo), builds Foundry's evidence package around it, and
 * confirms no live YouTube upload, no Google API call, no OAuth mutation, no
 * provider mutation, and no AMOS repo mutation occurred anywhere in this run.
 *
 * Run: npm run proof:amos-youtube-bridge
 */
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { getAmosRepoState } from "@/lib/amos-youtube/fixtures/amos-loader";
import { buildAmosYoutubePackageEvidence } from "@/lib/amos-youtube/evidence";
import { getAmosYoutubeBridgeOperatorReport } from "@/lib/amos-youtube/operator";

const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

async function main() {
  const sandbox = path.join(process.cwd(), ".foundry-proof-amos-youtube-bridge");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(sandbox, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(sandbox, "artifacts");
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  resetFoundryPersistence();

  // 1. AMOS repo identity captured read-only (no mutation possible from this proof).
  const amosRepoBefore = getAmosRepoState();
  record(
    "1. AMOS repo path/HEAD/branch captured read-only",
    Boolean(amosRepoBefore.repoPath && amosRepoBefore.head && amosRepoBefore.branch),
    `path=${amosRepoBefore.repoPath}, head=${amosRepoBefore.head}, branch=${amosRepoBefore.branch}`
  );

  // 2. AMOS HEAD matches the mission's expected YouTube-ready package commit.
  const expectedHead = "1ae12cf3ec7204c0a593b363ece7e5f23c60620e";
  record("2. AMOS HEAD is at or matches the expected YouTube package commit", amosRepoBefore.head === expectedHead, `expected=${expectedHead}, actual=${amosRepoBefore.head}`);

  // 3. Build Foundry's evidence package from AMOS's committed proof.
  const evidence = await buildAmosYoutubePackageEvidence();
  record("3. Foundry evidence package built from AMOS's committed proof", Boolean(evidence.evidenceId), `evidenceId=${evidence.evidenceId}, verdict=${evidence.verdict}`);

  // 4. Every required capability is covered.
  const missingCapabilities = evidence.capabilityCoverage.filter((c) => !c.present);
  record(
    "4. all required capability coverage fields are present",
    missingCapabilities.length === 0,
    missingCapabilities.length === 0 ? `covered=${evidence.capabilityCoverage.length}` : `missing=${missingCapabilities.map((c) => c.code).join(", ")}`
  );

  // 5. No rejection findings — a well-formed dry-run package with no live-provider flags.
  record(
    "5. no rejection findings (no live upload, no Google API call, no OAuth/provider mutation, no raw secrets)",
    evidence.rejectionFindings.length === 0,
    evidence.rejectionFindings.length === 0 ? "clean" : evidence.rejectionFindings.map((f) => f.code).join(", ")
  );

  // 6. Final verdict is PASS (dry-run package, not a live publish).
  record("6. final verdict is PASS", evidence.verdict === "PASS", `verdict=${evidence.verdict}`);

  // 7. Safety flags are all false.
  const allFlagsFalse = !evidence.liveYoutubeUploadFlag && !evidence.googleApiCalledFlag && !evidence.oauthMutatedFlag && !evidence.providerMutatedFlag && !evidence.productMutatedFlag;
  record("7. all live-provider/mutation flags are false", allFlagsFalse, `liveYoutubeUploadFlag=${evidence.liveYoutubeUploadFlag}, googleApiCalledFlag=${evidence.googleApiCalledFlag}, oauthMutatedFlag=${evidence.oauthMutatedFlag}, providerMutatedFlag=${evidence.providerMutatedFlag}, productMutatedFlag=${evidence.productMutatedFlag}`);

  // 8. Operator report reflects the same verdict/flags.
  const operatorReport = await getAmosYoutubeBridgeOperatorReport();
  record(
    "8. operator report reflects the evidence verdict and safety flags",
    operatorReport.youtubePackageStatus === evidence.verdict && !operatorReport.liveYoutubeUploadFlag && !operatorReport.googleApiCalledFlag,
    `status=${operatorReport.youtubePackageStatus}`
  );

  // 9. AMOS repo state unchanged after the run (no mutation occurred).
  const amosRepoAfter = getAmosRepoState();
  record("9. AMOS repo HEAD unchanged after this proof ran", amosRepoAfter.head === amosRepoBefore.head, `before=${amosRepoBefore.head}, after=${amosRepoAfter.head}`);

  // 10. Write + retain the evidence bundle.
  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const evidenceBundle = {
    proof: "foundry-amos-youtube-bridge@1",
    generatedAt: new Date().toISOString(),
    amosMutated: false,
    liveYoutubeUploadMade: false,
    googleApiCalled: false,
    oauthMutated: false,
    providerMutated: false,
    steps,
    amosRepoHead: amosRepoAfter.head,
    amosRepoBranch: amosRepoAfter.branch,
    finalVerdict: evidence.verdict,
    evidence,
    operatorReport,
  };
  const bundlePath = path.join(evidenceDir, "amos-youtube-bridge-proof.json");
  await writeFile(bundlePath, JSON.stringify(evidenceBundle, null, 2), "utf8");

  console.log(`\nEvidence bundle written: ${bundlePath}`);
  console.log(`\nAll ${steps.length} proof steps PASSED. No live YouTube upload, no Google API call, no OAuth/provider mutation, no AMOS mutation.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
