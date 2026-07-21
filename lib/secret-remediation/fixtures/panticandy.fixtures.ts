import type { SecretExposureFindingInput } from "../types";

/**
 * PantiCandy fixture cases (Task 5), authored directly from the read-only
 * containment docs in `C:\REPLIT PROJECTS\Panticandy\Panticandy` (see
 * FOUNDRY_SECRET_REMEDIATION_CURRENT_TRUTH.md for the full source list). No
 * secret value from those docs is reproduced here — only category, location,
 * and the commit/config metadata those docs themselves already disclosed.
 */

/** PANTICANDY_SECRET_CONTAINMENT_CURRENT_TRUTH.md — PAT embedded in local git remote URL, already stripped locally. */
export const PANTICANDY_PAT_FIXTURE: SecretExposureFindingInput = {
  project: "panticandy",
  filePath: ".git/config",
  sourceReference: "remote.origin.url at repo HEAD 81ff4680d33a9ee24bb6a3f2d120b98002e2daaa (PANTICANDY_SECRET_CONTAINMENT_CURRENT_TRUTH.md)",
  secretCategory: "github_pat",
  exposureLocation: "local_git_config",
  severity: "high",
  containmentStatus: "contained",
  rotationRequired: true,
  historyRewriteRequired: "not_applicable",
  deploymentEnvUpdateRequired: false,
  notes: "Local git config credential stripped (URL rewritten to a credential-free form); revocation/rotation at GitHub is an outstanding owner action per PANTICANDY_SECRET_CONTAINMENT_ACTIONS.md.",
};

/** PANTICANDY_ENV_HISTORY_CURRENT_TRUTH.md — historical .env carrying the production Neon DATABASE_URL. */
export const PANTICANDY_DATABASE_URL_HISTORY_FIXTURE: SecretExposureFindingInput = {
  project: "panticandy",
  filePath: ".env",
  sourceReference: "commits 04c356cf3cf4c467c704220f51a71b38c0415884 (added) and 3c1fed415c5e0d988de96ad34949d2d7a737b005 (removed) — PANTICANDY_ENV_HISTORY_CURRENT_TRUTH.md",
  secretCategory: "database_url",
  exposureLocation: "git_history",
  severity: "critical",
  containmentStatus: "partially_contained",
  rotationRequired: true,
  historyRewriteRequired: "optional",
  deploymentEnvUpdateRequired: true,
  notes: "Currently untracked and gitignored going forward, but the exposing commit was never scrubbed from history — rotate-vs-history-rewrite is an explicit unresolved owner decision per PANTICANDY_ENV_HISTORY_ACTIONS.md.",
};

export function loadPanticandyFixtures(): SecretExposureFindingInput[] {
  return [PANTICANDY_PAT_FIXTURE, PANTICANDY_DATABASE_URL_HISTORY_FIXTURE];
}
