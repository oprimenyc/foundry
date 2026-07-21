import { spawnSync } from "child_process";
import type { FylrBillingTestRunResult, FylrRepoState } from "../types";

/**
 * Reads fylr's real, already-committed billing state and test suite
 * read-only, from wherever the fylr repo lives on this machine. Foundry
 * never imports fylr source code and never writes to any path under the
 * fylr repo — mirrors lib/amos-youtube/fixtures/amos-loader.ts's read-only
 * discipline for AMOS.
 */

export const DEFAULT_FYLR_REPO_PATH = "C:\\REPLIT PROJECTS\\fylr\\fylr";

function fylrRepoPath(): string {
  return process.env.FYLR_REPO_PATH || DEFAULT_FYLR_REPO_PATH;
}

/** Read-only `git -C <fylrRepoPath>` handshake — never mutates the fylr repo. */
export function getFylrRepoState(repoPath: string = fylrRepoPath()): FylrRepoState {
  const head = spawnSync("git", ["-C", repoPath, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0 || !head.stdout.trim()) {
    throw new Error(`[fylr-loader] could not read fylr repo HEAD at ${repoPath}: ${head.stderr || head.error?.message || "unknown error"}`);
  }
  const branch = spawnSync("git", ["-C", repoPath, "branch", "--show-current"], { encoding: "utf8" });
  if (branch.status !== 0) {
    throw new Error(`[fylr-loader] could not read fylr repo branch at ${repoPath}: ${branch.stderr || branch.error?.message || "unknown error"}`);
  }
  return { repoPath, head: head.stdout.trim(), branch: branch.stdout.trim() };
}

/**
 * Read-only fylr billing lifecycle pytest suite. Runs fylr's own,
 * already-committed test files exactly as-is — this bridge authors no test
 * logic of its own. tests/test_billing_lifecycle.py forces
 * `DATABASE_URL=sqlite://` (in-memory) itself, so this never touches fylr's
 * real database or writes to the fylr repo. Never calls live Stripe: every
 * webhook POST in these tests patches `app.billing.stripe` and constructs a
 * genuine offline HMAC signature (see tests/test_billing_lifecycle.py
 * ::_stripe_signed_payload) against the real `/billing/webhook` route.
 *
 * tests/test_webhook_signature_rejection.py (added in fylr commit
 * aecb6bc4aec2baf505557a13459cc116fcde514d) closes the previously-open
 * UNSIGNED_WEBHOOK_REJECTION_UNIT_TESTED coverage gap. Unlike the two files
 * above it does NOT mock `app.billing.stripe` — it exercises the real
 * `stripe.Webhook.construct_event` signature-verification path with a
 * genuine offline HMAC signature (same construction, no network call), so a
 * regression that silently bypassed verification would fail it even though
 * the mocked lifecycle tests stay green.
 */
const BILLING_TEST_ARGS = [
  "-m",
  "pytest",
  "tests/test_billing_lifecycle.py",
  "tests/test_silent_failures.py::test_webhook_idempotency_no_double_fulfill",
  "tests/test_silent_failures.py::test_sf05_webhook_double_commit_failure_returns_5xx",
  "tests/test_webhook_signature_rejection.py",
  "-v",
  "--tb=short",
];

export function runFylrBillingLifecycleTests(repoPath: string = fylrRepoPath()): FylrBillingTestRunResult {
  const result = spawnSync("python", BILLING_TEST_ARGS, { cwd: repoPath, encoding: "utf8" });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const combined = stdout + stderr;

  const testNames = Array.from(combined.matchAll(/^(tests\/\S+)\s+PASSED/gm)).map((m) => m[1]);
  const failedNames = Array.from(combined.matchAll(/^(tests\/\S+)\s+FAILED/gm)).map((m) => m[1]);
  const summaryMatch = combined.match(/(\d+) passed(?:, (\d+) failed)?/);
  const passed = summaryMatch ? Number(summaryMatch[1]) : testNames.length;
  const failed = summaryMatch && summaryMatch[2] ? Number(summaryMatch[2]) : failedNames.length;

  const tailLines = combined.trim().split("\n");
  const rawTail = tailLines.slice(Math.max(0, tailLines.length - 15)).join("\n");

  return {
    command: `python ${BILLING_TEST_ARGS.join(" ")}`,
    exitCode: result.status ?? 1,
    passed,
    failed,
    testNames,
    rawTail,
  };
}
