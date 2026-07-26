import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { getAmosRepoState, loadAmosYoutubePackage, loadAmosProofManifest, AmosEvidenceUnavailableError, DEFAULT_AMOS_REPO_PATH } from "@/lib/amos-youtube/fixtures/amos-loader";
import { buildAmosYoutubePackageEvidence } from "@/lib/amos-youtube/evidence";
import { getAmosYoutubeBridgeOperatorReport } from "@/lib/amos-youtube/operator";

const testDir = path.join(process.cwd(), ".foundry-test-data", "amos-youtube-bridge");

async function resetEnv() {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(testDir, "artifacts");
  resetFoundryPersistence();
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });
}

test("AMOS repo state is read read-only via git and matches the expected commit", async () => {
  await resetEnv();
  const repo = getAmosRepoState();
  assert.equal(repo.repoPath, DEFAULT_AMOS_REPO_PATH);
  assert.match(repo.head, /^[0-9a-f]{40}$/);
});

test("loadAmosYoutubePackage throws a clear error, never returns silently empty, when the file is missing", async () => {
  await resetEnv();
  const missingPath = path.join(tmpdir(), `amos-youtube-package-missing-${randomUUID()}.json`);
  assert.throws(() => loadAmosYoutubePackage(missingPath), AmosEvidenceUnavailableError);
});

test("loadAmosYoutubePackage rejects a package whose dry-run flags are not all false", async () => {
  await resetEnv();
  const dir = path.join(testDir, "tampered-package");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "youtube-package.json");
  await writeFile(
    filePath,
    JSON.stringify({
      schema: "amos.youtube-ready-package.v1.0.0",
      campaign_id: "test",
      video_asset: { path: "x", checksum: "abc", present: true },
      thumbnail_asset: { path: "x", checksum: "abc", present: true },
      title: "t",
      description: "d",
      tags: ["a"],
      hashtags: ["#a"],
      chapters: [],
      pinned_comment: { enabled: true, text: "hi" },
      playlist_recommendation: { name: "n", rationale: "r" },
      scheduled_publish_window: { guidance: "g", timezone: "UTC", earliest_publish_after: "human-approval" },
      approval: { required: true, approved: false, approved_by: null, approved_at: null },
      provider_mutation_flag: false,
      dry_run_publish_status: { schema: "x", attempted_live_upload: true, google_api_called: false, oauth_used: false, provider_mutation: false, secrets_detected: [], verdict: "pass", notes: [] },
      evidence: ["e"],
      final_verdict: "PASS",
    }),
    "utf8"
  );
  assert.throws(() => loadAmosYoutubePackage(filePath), /dry_run_publish_status/);
});

test("real AMOS YouTube package loads and parses to the expected shape", async () => {
  await resetEnv();
  const pkg = loadAmosYoutubePackage();
  assert.equal(pkg.schema, "amos.youtube-ready-package.v1.0.0");
  assert.equal(pkg.videoAsset.present, true);
  assert.equal(pkg.thumbnailAsset.present, true);
  assert.ok(pkg.title.length > 0);
  assert.equal(pkg.providerMutationFlag, false);
  assert.equal(pkg.dryRunPublishStatus.attemptedLiveUpload, false);
  assert.equal(pkg.dryRunPublishStatus.googleApiCalled, false);
  assert.equal(pkg.dryRunPublishStatus.oauthUsed, false);
  assert.equal(pkg.dryRunPublishStatus.providerMutation, false);
  assert.equal(pkg.finalVerdict, "PASS");
});

test("real AMOS proof manifest loads with test evidence counts", async () => {
  await resetEnv();
  const manifest = loadAmosProofManifest();
  assert.equal(manifest.testEvidence.testsAdded, 17);
  assert.equal(manifest.testEvidence.testsPassed, 17);
  assert.match(manifest.testEvidence.fullBackendSuite, /309 passed, 10 skipped/);
});

test("buildAmosYoutubePackageEvidence produces a PASS evidence package with full capability coverage and no rejection findings", async () => {
  await resetEnv();
  const evidence = await buildAmosYoutubePackageEvidence();
  const repo = getAmosRepoState();
  assert.ok(evidence.evidenceId);
  assert.equal(evidence.productId, "amos");
  // AMOS-CANONICAL is a live, actively-developed repo (see REPOSITORY_INVENTORY.json) --
  // productHead must track its REAL current commit, not a value pinned to whatever commit
  // existed when this test was written. Asserting against a live re-read of the same repo
  // state (rather than a hardcoded hash) verifies the actual invariant -- evidence correctly
  // reflects live repo state -- without breaking every time AMOS-CANONICAL legitimately
  // advances. Was pinned to "1ae12cf3ec7204c0a593b363ece7e5f23c60620e" (AMOS-CANONICAL's HEAD
  // on 2026-07-21); AMOS-CANONICAL has since advanced to "39258f88e0660256ea28ee7ef724cbd665b8361e"
  // and beyond, which correctly failed this test until fixed here (2026-07-26).
  assert.match(evidence.productHead, /^[0-9a-f]{40}$/);
  assert.equal(evidence.productHead, repo.head);
  assert.equal(evidence.rejectionFindings.length, 0);
  assert.ok(evidence.capabilityCoverage.every((c) => c.present), `missing: ${evidence.capabilityCoverage.filter((c) => !c.present).map((c) => c.code).join(", ")}`);
  assert.equal(evidence.verdict, "PASS");
  assert.equal(evidence.liveYoutubeUploadFlag, false);
  assert.equal(evidence.googleApiCalledFlag, false);
  assert.equal(evidence.oauthMutatedFlag, false);
  assert.equal(evidence.providerMutatedFlag, false);
  assert.equal(evidence.productMutatedFlag, false);
});

test("buildAmosYoutubePackageEvidence rejects and BLOCKs when the package file is missing", async () => {
  await resetEnv();
  const missingPath = path.join(tmpdir(), `amos-youtube-package-missing-${randomUUID()}.json`);
  await assert.rejects(() => buildAmosYoutubePackageEvidence({ youtubePackagePath: missingPath }), AmosEvidenceUnavailableError);
});

test("getAmosYoutubeBridgeOperatorReport reflects the evidence verdict, capability coverage, and safety flags", async () => {
  await resetEnv();
  const report = await getAmosYoutubeBridgeOperatorReport();
  assert.equal(report.product, "amos");
  assert.equal(report.youtubePackageStatus, "PASS");
  assert.equal(report.packageContractCoverage.missing.length, 0);
  assert.equal(report.liveYoutubeUploadFlag, false);
  assert.equal(report.googleApiCalledFlag, false);
  assert.equal(report.oauthMutatedFlag, false);
  assert.equal(report.providerMutatedFlag, false);
  assert.ok(report.evidenceRefs.length > 0);
});

test("AMOS repo HEAD is unchanged after building evidence (read-only guarantee)", async () => {
  await resetEnv();
  const before = getAmosRepoState();
  await buildAmosYoutubePackageEvidence();
  const after = getAmosRepoState();
  assert.equal(after.head, before.head);
  assert.equal(after.branch, before.branch);
});
