/**
 * Foundry AMOS YouTube Package Bridge — contract types.
 *
 * AMOS (C:\Users\jp718\OneDrive\Desktop\_SORTED\Active_Projects\AMOS-CANONICAL,
 * read-only source of truth) already builds a dry-run "YouTube-ready provider
 * package" (backend/src/amos/campaign/youtube_package.py, schema
 * "amos.youtube-ready-package.v1.0.0"). This module does not rebuild that
 * package — it defines Foundry's evidence-package wrapper around AMOS's real,
 * already-committed proof artifacts (proofs/youtube-package/*.json) so the
 * capability can flow AMOS -> Foundry -> VERIDIAN -> E.V.E. without Foundry
 * ever writing to AMOS or calling a live YouTube/Google API.
 *
 * Same design rule as lib/provider-actions/types.ts: nothing here performs a
 * live provider action. `dryRunPublishStatus` fields are read verbatim from
 * AMOS's own committed proof, never re-derived by calling anything live.
 */

export const AMOS_YOUTUBE_VERDICTS = ["PASS", "FAIL", "BLOCKED", "PASS_WITH_WARNINGS"] as const;
export type AmosYoutubePackageVerdict = (typeof AMOS_YOUTUBE_VERDICTS)[number];

/** Mirrors AMOS's `YouTubeAssetRef` (backend/src/amos/campaign/contracts.py). */
export interface AmosYoutubeAssetRef {
  path: string;
  checksum: string;
  present: boolean;
}

/** Mirrors AMOS's `DryRunPublishResult` (contracts.py, always Literal[False] on every mutation flag). */
export interface AmosDryRunPublishStatus {
  schema: string;
  attemptedLiveUpload: false;
  googleApiCalled: false;
  oauthUsed: false;
  providerMutation: false;
  secretsDetected: string[];
  verdict: string;
  notes: string[];
}

/** The real AMOS `youtube-package.json` shape, read verbatim (read-only) from AMOS's committed proof. */
export interface AmosYoutubePackage {
  schema: string;
  campaignId: string;
  videoAsset: AmosYoutubeAssetRef;
  thumbnailAsset: AmosYoutubeAssetRef;
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  chapters: Array<{ timestamp: string; title: string }>;
  pinnedComment: { enabled: boolean; text: string };
  playlistRecommendation: { name: string; rationale: string };
  scheduledPublishWindow: { guidance: string; timezone: string; earliestPublishAfter: string };
  approval: { required: boolean; approved: boolean; approvedBy: string | null; approvedAt: string | null };
  providerMutationFlag: false;
  dryRunPublishStatus: AmosDryRunPublishStatus;
  evidence: string[];
  finalVerdict: string;
}

/** Read-only AMOS repo identity, captured via `git -C <amosRepoPath>` — never mutates AMOS. */
export interface AmosRepoState {
  repoPath: string;
  head: string;
  branch: string;
}

/** One required-capability check in the coverage checklist (mission Phase 2 required-capability list). */
export interface AmosYoutubeCapabilityCheck {
  code: string;
  label: string;
  present: boolean;
}

/**
 * Rejection reasons Foundry's evidence builder enforces (mission Phase 3
 * "must reject" list). Any one of these present blocks a PASS verdict.
 */
export const AMOS_YOUTUBE_REJECTION_CODES = [
  "MISSING_PRODUCT_HEAD",
  "MISSING_PACKAGE_CONTRACT_PROOF",
  "MISSING_DRY_RUN_ADAPTER_PROOF",
  "MISSING_EVIDENCE_REFS",
  "LIVE_UPLOAD_WITHOUT_APPROVAL",
  "GOOGLE_API_CALL_WITHOUT_APPROVAL",
  "OAUTH_MUTATION_WITHOUT_APPROVAL",
  "PROVIDER_MUTATION_WITHOUT_APPROVAL",
  "RAW_SECRET_DETECTED",
  "REPLIT_DEPLOYMENT_TARGET_INFERRED",
] as const;
export type AmosYoutubeRejectionCode = (typeof AMOS_YOUTUBE_REJECTION_CODES)[number];

export interface AmosYoutubeRejectionFinding {
  code: AmosYoutubeRejectionCode;
  message: string;
}

/** The standardized, machine-readable Foundry evidence package for AMOS's YouTube package capability. */
export interface AmosYoutubePackageEvidence {
  evidenceId: string;
  productId: "amos";
  productName: "AMOS";
  productRepoPath: string;
  productHead: string;
  productBranch: string;
  contentProviderClassification: "youtube_video_publishing";
  capabilityCoverage: AmosYoutubeCapabilityCheck[];
  packageContractProofRef: string;
  packageBuilderProofRef: string;
  dryRunAdapterProofRef: string;
  operatorSurfaceProofRef: string;
  testProofRefs: string[];
  commandEvidenceRefs: string[];
  generatedPackageRef: { path: string; sha256: string } | null;
  approvalGateState: { required: boolean; approved: boolean };
  liveYoutubeUploadFlag: false;
  googleApiCalledFlag: false;
  oauthMutatedFlag: false;
  providerMutatedFlag: false;
  productMutatedFlag: false;
  rejectionFindings: AmosYoutubeRejectionFinding[];
  verdict: AmosYoutubePackageVerdict;
  generatedAt: string;
}
