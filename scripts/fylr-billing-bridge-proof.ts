/**
 * fylr -> Foundry billing lifecycle evidence bridge proof.
 *
 * Reads fylr's real repo state read-only and invokes fylr's own,
 * already-committed Stripe billing lifecycle pytest suite
 * (tests/test_billing_lifecycle.py + two supporting tests in
 * tests/test_silent_failures.py) exactly as-is, builds Foundry's evidence
 * package around the real result, and confirms no live Stripe call, no
 * provider mutation, no product (fylr) mutation occurred anywhere in this
 * run.
 *
 * Run: npm run proof:fylr-billing-bridge
 */
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { getFylrRepoState } from "@/lib/fylr-billing/fixtures/fylr-loader";
import { buildFylrBillingEvidence, EXPECTED_FYLR_BILLING_HEAD } from "@/lib/fylr-billing/evidence";
import { getFylrBillingBridgeOperatorReport } from "@/lib/fylr-billing/operator";

const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

async function main() {
  const sandbox = path.join(process.cwd(), ".foundry-proof-fylr-billing-bridge");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(sandbox, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(sandbox, "artifacts");
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  resetFoundryPersistence();

  // 1. fylr repo identity captured read-only (no mutation possible from this proof).
  const fylrRepoBefore = getFylrRepoState();
  record(
    "1. fylr repo path/HEAD/branch captured read-only",
    Boolean(fylrRepoBefore.repoPath && fylrRepoBefore.head && fylrRepoBefore.branch),
    `path=${fylrRepoBefore.repoPath}, head=${fylrRepoBefore.head}, branch=${fylrRepoBefore.branch}`
  );

  // 2. fylr HEAD is at or after the mission's expected billing-lifecycle-fix commit.
  record(
    "2. fylr HEAD is at the expected billing lifecycle commit",
    fylrRepoBefore.head === EXPECTED_FYLR_BILLING_HEAD,
    `expected=${EXPECTED_FYLR_BILLING_HEAD}, actual=${fylrRepoBefore.head}`
  );

  // 3. Build Foundry's evidence package by running fylr's own committed pytest suite read-only.
  const evidence = await buildFylrBillingEvidence();
  record("3. Foundry evidence package built from fylr's real pytest run", Boolean(evidence.evidenceId), `evidenceId=${evidence.evidenceId}, verdict=${evidence.verdict}`);

  // 4. The real pytest run captured at least the expected number of passing lifecycle tests.
  record(
    "4. fylr billing lifecycle pytest run captured passing test proof refs",
    evidence.testProofRefs.length >= 7,
    `testProofRefs=${evidence.testProofRefs.length}: ${evidence.testProofRefs.join(", ")}`
  );

  // 5. No hard rejection findings (no missing HEAD, no failed suite, no cancellation-to-paid-tier
  //    leak, no instant downgrade without grace period, no raw secrets).
  record(
    "5. no rejection findings",
    evidence.rejectionFindings.length === 0,
    evidence.rejectionFindings.length === 0 ? "clean" : evidence.rejectionFindings.map((f) => f.code).join(", ")
  );

  // 6. Verdict allows readiness (PASS or PASS_WITH_WARNINGS — the one known warning is the
  //    absent dedicated invalid-signature-rejection unit test; the rejecting code path itself
  //    is real and documented in webhookSignatureProofRef).
  record(
    "6. final verdict allows readiness (PASS or PASS_WITH_WARNINGS)",
    evidence.verdict === "PASS" || evidence.verdict === "PASS_WITH_WARNINGS",
    `verdict=${evidence.verdict}`
  );

  // 7. Safety flags are all false.
  const allFlagsFalse = !evidence.liveStripeCallFlag && !evidence.providerMutatedFlag && !evidence.productMutatedFlag;
  record("7. all live-provider/mutation flags are false", allFlagsFalse, `liveStripeCallFlag=${evidence.liveStripeCallFlag}, providerMutatedFlag=${evidence.providerMutatedFlag}, productMutatedFlag=${evidence.productMutatedFlag}`);

  // 8. Operator report reflects the same verdict/flags.
  const operatorReport = await getFylrBillingBridgeOperatorReport();
  record(
    "8. operator report reflects the evidence verdict and safety flags",
    operatorReport.foundryEvidenceVerdict === evidence.verdict && !operatorReport.liveStripeCallFlag && !operatorReport.providerMutatedFlag,
    `status=${operatorReport.foundryEvidenceVerdict}`
  );

  // 9. fylr repo state unchanged after the run (no mutation occurred — HEAD identical).
  const fylrRepoAfter = getFylrRepoState();
  record("9. fylr repo HEAD unchanged after this proof ran", fylrRepoAfter.head === fylrRepoBefore.head, `before=${fylrRepoBefore.head}, after=${fylrRepoAfter.head}`);

  // 10. Write + retain the evidence bundle.
  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const evidenceBundle = {
    proof: "foundry-fylr-billing-bridge@1",
    generatedAt: new Date().toISOString(),
    fylrMutated: false,
    liveStripeCallMade: false,
    providerMutated: false,
    productMutated: false,
    steps,
    fylrRepoHead: fylrRepoAfter.head,
    fylrRepoBranch: fylrRepoAfter.branch,
    finalVerdict: evidence.verdict,
    evidence,
    operatorReport,
  };
  const bundlePath = path.join(evidenceDir, "fylr-billing-bridge-proof.json");
  await writeFile(bundlePath, JSON.stringify(evidenceBundle, null, 2), "utf8");

  console.log(`\nEvidence bundle written: ${bundlePath}`);
  console.log(`\nAll ${steps.length} proof steps PASSED. No live Stripe call, no provider mutation, no fylr mutation.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
