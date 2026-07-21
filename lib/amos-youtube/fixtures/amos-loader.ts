import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import type { AmosRepoState, AmosYoutubePackage } from "../types";

/**
 * Reads AMOS's real, already-committed YouTube package proof read-only, from
 * wherever the AMOS repo lives on this machine. Foundry never imports AMOS
 * source code and never writes to any path under the AMOS repo — mirrors
 * lib/email-qa/fixtures/dyln-loader.ts's read-only discipline for dyln.
 */

export const DEFAULT_AMOS_REPO_PATH = "C:\\Users\\jp718\\OneDrive\\Desktop\\_SORTED\\Active_Projects\\AMOS-CANONICAL";
export const DEFAULT_AMOS_YOUTUBE_PACKAGE_PATH = path.join(DEFAULT_AMOS_REPO_PATH, "proofs", "youtube-package", "youtube-package.json");
export const DEFAULT_AMOS_PROOF_MANIFEST_PATH = path.join(DEFAULT_AMOS_REPO_PATH, "proofs", "youtube-package", "PROOF_MANIFEST.json");

function amosRepoPath(): string {
  return process.env.AMOS_REPO_PATH || DEFAULT_AMOS_REPO_PATH;
}

function amosYoutubePackagePath(): string {
  return process.env.AMOS_YOUTUBE_PACKAGE_PATH || DEFAULT_AMOS_YOUTUBE_PACKAGE_PATH;
}

function amosProofManifestPath(): string {
  return process.env.AMOS_PROOF_MANIFEST_PATH || DEFAULT_AMOS_PROOF_MANIFEST_PATH;
}

/** Read-only `git -C <amosRepoPath>` handshake — never mutates the AMOS repo. */
export function getAmosRepoState(repoPath: string = amosRepoPath()): AmosRepoState {
  const head = spawnSync("git", ["-C", repoPath, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0 || !head.stdout.trim()) {
    throw new Error(`[amos-loader] could not read AMOS repo HEAD at ${repoPath}: ${head.stderr || head.error?.message || "unknown error"}`);
  }
  const branch = spawnSync("git", ["-C", repoPath, "branch", "--show-current"], { encoding: "utf8" });
  if (branch.status !== 0) {
    throw new Error(`[amos-loader] could not read AMOS repo branch at ${repoPath}: ${branch.stderr || branch.error?.message || "unknown error"}`);
  }
  return { repoPath, head: head.stdout.trim(), branch: branch.stdout.trim() };
}

export class AmosEvidenceUnavailableError extends Error {
  constructor(filePath: string, reason: string) {
    super(`[amos-loader] AMOS YouTube package evidence unavailable at ${filePath}: ${reason}`);
    this.name = "AmosEvidenceUnavailableError";
  }
}

const REQUIRED_TOP_LEVEL_FIELDS = [
  "schema",
  "campaign_id",
  "video_asset",
  "thumbnail_asset",
  "title",
  "description",
  "tags",
  "hashtags",
  "chapters",
  "pinned_comment",
  "playlist_recommendation",
  "scheduled_publish_window",
  "approval",
  "provider_mutation_flag",
  "dry_run_publish_status",
  "evidence",
  "final_verdict",
] as const;

/** Independent shape validation of AMOS's committed proof JSON — no AMOS code imported. */
function validateAmosPackageShape(raw: Record<string, unknown>, sourceLabel: string): void {
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in raw)) {
      throw new AmosEvidenceUnavailableError(sourceLabel, `missing required field "${field}"`);
    }
  }
  if (raw.provider_mutation_flag !== false) {
    throw new AmosEvidenceUnavailableError(sourceLabel, `"provider_mutation_flag" must be exactly false, got ${JSON.stringify(raw.provider_mutation_flag)}`);
  }
  const dryRun = raw.dry_run_publish_status as Record<string, unknown> | undefined;
  if (!dryRun || dryRun.attempted_live_upload !== false || dryRun.google_api_called !== false || dryRun.oauth_used !== false || dryRun.provider_mutation !== false) {
    throw new AmosEvidenceUnavailableError(sourceLabel, `"dry_run_publish_status" flags must all be exactly false`);
  }
}

/** Loads AMOS's real, committed `youtube-package.json`. Throws — never silently returns empty (Constitution §1). */
export function loadAmosYoutubePackage(filePath: string = amosYoutubePackagePath()): AmosYoutubePackage {
  if (!existsSync(filePath)) {
    throw new AmosEvidenceUnavailableError(filePath, "file not found");
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new AmosEvidenceUnavailableError(filePath, `not valid JSON: ${(error as Error).message}`);
  }
  validateAmosPackageShape(raw, filePath);

  const dryRun = raw.dry_run_publish_status as Record<string, unknown>;
  const videoAsset = raw.video_asset as Record<string, unknown>;
  const thumbnailAsset = raw.thumbnail_asset as Record<string, unknown>;
  const playlist = raw.playlist_recommendation as Record<string, unknown>;
  const schedule = raw.scheduled_publish_window as Record<string, unknown>;
  const approval = raw.approval as Record<string, unknown>;
  const pinnedComment = raw.pinned_comment as Record<string, unknown>;

  return {
    schema: String(raw.schema),
    campaignId: String(raw.campaign_id),
    videoAsset: { path: String(videoAsset.path), checksum: String(videoAsset.checksum), present: Boolean(videoAsset.present) },
    thumbnailAsset: { path: String(thumbnailAsset.path), checksum: String(thumbnailAsset.checksum), present: Boolean(thumbnailAsset.present) },
    title: String(raw.title),
    description: String(raw.description),
    tags: (raw.tags as string[]) ?? [],
    hashtags: (raw.hashtags as string[]) ?? [],
    chapters: (raw.chapters as Array<{ timestamp: string; title: string }>) ?? [],
    pinnedComment: { enabled: Boolean(pinnedComment.enabled), text: String(pinnedComment.text ?? "") },
    playlistRecommendation: { name: String(playlist.name ?? ""), rationale: String(playlist.rationale ?? "") },
    scheduledPublishWindow: {
      guidance: String(schedule.guidance ?? ""),
      timezone: String(schedule.timezone ?? ""),
      earliestPublishAfter: String(schedule.earliest_publish_after ?? ""),
    },
    approval: {
      required: Boolean(approval.required),
      approved: Boolean(approval.approved),
      approvedBy: (approval.approved_by as string | null) ?? null,
      approvedAt: (approval.approved_at as string | null) ?? null,
    },
    providerMutationFlag: false,
    dryRunPublishStatus: {
      schema: String(dryRun.schema ?? ""),
      attemptedLiveUpload: false,
      googleApiCalled: false,
      oauthUsed: false,
      providerMutation: false,
      secretsDetected: (dryRun.secrets_detected as string[]) ?? [],
      verdict: String(dryRun.verdict ?? ""),
      notes: (dryRun.notes as string[]) ?? [],
    },
    evidence: (raw.evidence as string[]) ?? [],
    finalVerdict: String(raw.final_verdict),
  };
}

export interface AmosProofManifest {
  proof: string;
  campaignId: string;
  testEvidence: {
    newTestFile: string;
    testsAdded: number;
    testsPassed: number;
    fullBackendSuite: string;
  };
  finalVerdict: string;
}

/** Loads AMOS's real, committed `PROOF_MANIFEST.json` for its YouTube package proof. */
export function loadAmosProofManifest(filePath: string = amosProofManifestPath()): AmosProofManifest {
  if (!existsSync(filePath)) {
    throw new AmosEvidenceUnavailableError(filePath, "file not found");
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new AmosEvidenceUnavailableError(filePath, `not valid JSON: ${(error as Error).message}`);
  }
  const testEvidence = raw.test_evidence as Record<string, unknown>;
  return {
    proof: String(raw.proof ?? ""),
    campaignId: String(raw.campaign_id ?? ""),
    testEvidence: {
      newTestFile: String(testEvidence?.new_test_file ?? ""),
      testsAdded: Number(testEvidence?.tests_added ?? 0),
      testsPassed: Number(testEvidence?.tests_passed ?? 0),
      fullBackendSuite: String(testEvidence?.full_backend_suite ?? ""),
    },
    finalVerdict: String(raw.final_verdict ?? ""),
  };
}
