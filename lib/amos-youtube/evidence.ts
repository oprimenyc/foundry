import { sha256Canonical } from "@/lib/foundry/evidence-manifest";
import { retainArtifact } from "@/lib/foundry/artifacts";
import { scanForRawSecretMaterial } from "@/lib/secret-remediation/secret-scan";
import { getAmosRepoState, loadAmosYoutubePackage, loadAmosProofManifest } from "./fixtures/amos-loader";
import type {
  AmosYoutubeCapabilityCheck,
  AmosYoutubePackage,
  AmosYoutubePackageEvidence,
  AmosYoutubeRejectionFinding,
  AmosYoutubePackageVerdict,
} from "./types";

const EVIDENCE_ARTIFACT_KIND = "amos_youtube_package_evidence";

/**
 * Required capability coverage checklist (mission Phase 2/3). Every entry
 * must be independently derivable from AMOS's own committed proof — nothing
 * here is asserted without a corresponding field check below.
 */
function buildCapabilityCoverage(pkg: AmosYoutubePackage): AmosYoutubeCapabilityCheck[] {
  return [
    { code: "PACKAGE_CONTRACT_EXISTS", label: "Package contract exists (schema amos.youtube-ready-package)", present: pkg.schema.startsWith("amos.youtube-ready-package") },
    { code: "VIDEO_ASSET_REF_CHECKSUM", label: "Video asset ref/checksum included", present: Boolean(pkg.videoAsset.checksum) && pkg.videoAsset.present },
    { code: "THUMBNAIL_ASSET_REF_CHECKSUM", label: "Thumbnail asset ref/checksum included", present: Boolean(pkg.thumbnailAsset.checksum) && pkg.thumbnailAsset.present },
    { code: "TITLE_INCLUDED", label: "Title included", present: pkg.title.trim().length > 0 },
    { code: "DESCRIPTION_INCLUDED", label: "Description included", present: pkg.description.trim().length > 0 },
    { code: "TAGS_HASHTAGS_INCLUDED", label: "Tags/hashtags included", present: pkg.tags.length > 0 && pkg.hashtags.length > 0 },
    { code: "CHAPTERS_TIMESTAMPS_SUPPORTED", label: "Chapters/timestamps supported or documented", present: pkg.chapters.length > 0 },
    { code: "PINNED_COMMENT_SUPPORTED", label: "Pinned comment supported or documented", present: pkg.pinnedComment.enabled && pkg.pinnedComment.text.trim().length > 0 },
    { code: "PLAYLIST_RECOMMENDATION_SUPPORTED", label: "Playlist recommendation supported or documented", present: pkg.playlistRecommendation.name.trim().length > 0 },
    { code: "SCHEDULE_RECOMMENDATION_INCLUDED", label: "Schedule recommendation included", present: pkg.scheduledPublishWindow.guidance.trim().length > 0 },
    { code: "APPROVAL_STATE_INCLUDED", label: "Approval state included", present: typeof pkg.approval.required === "boolean" && typeof pkg.approval.approved === "boolean" },
    { code: "DRY_RUN_PUBLISH_VERDICT_INCLUDED", label: "Dry-run publish verdict included", present: pkg.dryRunPublishStatus.verdict.trim().length > 0 },
    {
      code: "LIVE_UPLOAD_BLOCKED_WITHOUT_APPROVAL",
      label: "Live upload blocked without explicit approval",
      present: pkg.dryRunPublishStatus.attemptedLiveUpload === false && (!pkg.approval.approved || pkg.dryRunPublishStatus.attemptedLiveUpload === false),
    },
    { code: "GOOGLE_API_CALLS_DISABLED", label: "Google API calls disabled in proof", present: pkg.dryRunPublishStatus.googleApiCalled === false },
    { code: "OAUTH_MUTATION_DISABLED", label: "OAuth mutation disabled in proof", present: pkg.dryRunPublishStatus.oauthUsed === false },
    { code: "PROVIDER_MUTATION_DISABLED", label: "Provider mutation disabled in proof", present: pkg.dryRunPublishStatus.providerMutation === false && pkg.providerMutationFlag === false },
    { code: "EVIDENCE_REFS_INCLUDED", label: "Evidence refs included", present: pkg.evidence.length > 0 },
  ];
}

export interface BuildAmosYoutubePackageEvidenceOptions {
  amosRepoPath?: string;
  youtubePackagePath?: string;
  proofManifestPath?: string;
}

/**
 * Builds Foundry's evidence package for AMOS's YouTube package capability
 * from AMOS's own committed, read-only proof artifacts. Never calls a live
 * YouTube/Google API, never mutates OAuth/provider state, never writes to
 * the AMOS repo. Enforces the mission's Phase 3 "must reject" rules by
 * capping the verdict at FAIL/BLOCKED whenever a rejection finding fires —
 * a dry-run PASS never implies a live publish occurred.
 */
export async function buildAmosYoutubePackageEvidence(options: BuildAmosYoutubePackageEvidenceOptions = {}): Promise<AmosYoutubePackageEvidence> {
  const repo = getAmosRepoState(options.amosRepoPath);
  const pkg = loadAmosYoutubePackage(options.youtubePackagePath);
  const manifest = loadAmosProofManifest(options.proofManifestPath);

  const capabilityCoverage = buildCapabilityCoverage(pkg);
  const rejectionFindings: AmosYoutubeRejectionFinding[] = [];

  if (!repo.head) {
    rejectionFindings.push({ code: "MISSING_PRODUCT_HEAD", message: "AMOS repo HEAD could not be read." });
  }
  const contractCheck = capabilityCoverage.find((c) => c.code === "PACKAGE_CONTRACT_EXISTS");
  if (!contractCheck?.present) {
    rejectionFindings.push({ code: "MISSING_PACKAGE_CONTRACT_PROOF", message: "AMOS package contract proof is missing or malformed." });
  }
  const dryRunOk = pkg.dryRunPublishStatus.attemptedLiveUpload === false && pkg.dryRunPublishStatus.verdict.trim().length > 0;
  if (!dryRunOk) {
    rejectionFindings.push({ code: "MISSING_DRY_RUN_ADAPTER_PROOF", message: "AMOS dry-run publish adapter proof is missing or incomplete." });
  }
  if (pkg.evidence.length === 0) {
    rejectionFindings.push({ code: "MISSING_EVIDENCE_REFS", message: "AMOS package carries no evidence refs." });
  }
  // Live-provider-action flags are always required to be false; a mission approval override is
  // deliberately not implemented anywhere in this bridge (mirrors lib/provider-actions' "no live
  // executor exists" discipline) — any true value here is always rejected, approval or not.
  if (pkg.dryRunPublishStatus.attemptedLiveUpload !== false) {
    rejectionFindings.push({ code: "LIVE_UPLOAD_WITHOUT_APPROVAL", message: "AMOS proof declares a live YouTube upload was attempted." });
  }
  if (pkg.dryRunPublishStatus.googleApiCalled !== false) {
    rejectionFindings.push({ code: "GOOGLE_API_CALL_WITHOUT_APPROVAL", message: "AMOS proof declares a Google API call was made." });
  }
  if (pkg.dryRunPublishStatus.oauthUsed !== false) {
    rejectionFindings.push({ code: "OAUTH_MUTATION_WITHOUT_APPROVAL", message: "AMOS proof declares OAuth was used." });
  }
  if (pkg.dryRunPublishStatus.providerMutation !== false || pkg.providerMutationFlag !== false) {
    rejectionFindings.push({ code: "PROVIDER_MUTATION_WITHOUT_APPROVAL", message: "AMOS proof declares provider state was mutated." });
  }
  const secretMatches = [...scanForRawSecretMaterial(pkg), ...scanForRawSecretMaterial(manifest)];
  if (secretMatches.length > 0 || pkg.dryRunPublishStatus.secretsDetected.length > 0) {
    rejectionFindings.push({ code: "RAW_SECRET_DETECTED", message: "Raw secret-shaped material detected in AMOS proof evidence." });
  }
  // Replit is never inferred as a deployment target from this bridge — AMOS's dev provenance
  // (if any) is out of scope for this capability entirely; this bridge never emits a deployment
  // target of any kind, so REPLIT_DEPLOYMENT_TARGET_INFERRED can only ever be a manual finding.

  const missingCapabilities = capabilityCoverage.filter((c) => !c.present);
  let verdict: AmosYoutubePackageVerdict;
  if (rejectionFindings.length > 0) {
    verdict = "BLOCKED";
  } else if (missingCapabilities.length > 0) {
    verdict = "PASS_WITH_WARNINGS";
  } else if (pkg.finalVerdict.toUpperCase() !== "PASS") {
    verdict = "FAIL";
  } else {
    verdict = "PASS";
  }

  const generatedPackageRef = pkg.videoAsset.checksum
    ? { path: "proofs/youtube-package/youtube-package.json", sha256: sha256Canonical(pkg).replace(/^sha256:/, "") }
    : null;

  const evidence: Omit<AmosYoutubePackageEvidence, "evidenceId"> = {
    productId: "amos",
    productName: "AMOS",
    productRepoPath: repo.repoPath,
    productHead: repo.head,
    productBranch: repo.branch,
    contentProviderClassification: "youtube_video_publishing",
    capabilityCoverage,
    packageContractProofRef: "backend/src/amos/campaign/contracts.py:540-746 (YouTubeReadyPackage)",
    packageBuilderProofRef: "backend/src/amos/campaign/youtube_package.py (build_youtube_ready_package)",
    dryRunAdapterProofRef: "backend/src/amos/campaign/youtube_publish_adapter.py (scan_text_fields)",
    operatorSurfaceProofRef: "backend/src/amos/routes/campaigns.py:131-147 (GET /campaigns/{id}/youtube-package)",
    testProofRefs: [manifest.testEvidence.newTestFile, `full backend suite: ${manifest.testEvidence.fullBackendSuite}`],
    commandEvidenceRefs: [
      "PYTHONPATH=src python -m pytest tests/test_youtube_package.py -q",
      "PYTHONPATH=src python -m pytest -q",
      "python scripts/campaign_e2e.py",
    ],
    generatedPackageRef,
    approvalGateState: { required: pkg.approval.required, approved: pkg.approval.approved },
    liveYoutubeUploadFlag: false,
    googleApiCalledFlag: false,
    oauthMutatedFlag: false,
    providerMutatedFlag: false,
    productMutatedFlag: false,
    rejectionFindings,
    verdict,
    generatedAt: new Date().toISOString(),
  };

  const artifact = await retainArtifact({
    kind: EVIDENCE_ARTIFACT_KIND,
    content: evidence,
    contentType: "application/json",
    retentionClass: "RELEASE",
    producer: "amos-youtube-bridge",
    source: "amos-loader",
    projectId: "amos",
  });

  return { ...evidence, evidenceId: artifact.id };
}
