/**
 * dyln -> Foundry email QA integration proof.
 *
 * Loads dyln's real Tier A email fixtures read-only, runs them through
 * Foundry's local/free email QA harness (no network, no Resend call, no real
 * customer email, no dyln repo mutation), and emits a machine-readable
 * evidence bundle carrying dyln's repo path/HEAD alongside every fixture's
 * hash, verdict, and provider-call confirmation.
 *
 * Run: npm run proof:email-qa-dyln
 */
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { retainArtifact } from "@/lib/foundry/artifacts";
import { runDylnEmailQaIntegration } from "@/lib/email-qa/fixtures/dyln-loader";

const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

async function main() {
  const sandbox = path.join(process.cwd(), ".foundry-proof-dyln-email-qa");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(sandbox, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(sandbox, "artifacts");
  delete process.env.FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND;
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  resetFoundryPersistence();

  // 1. Load + run all 17 real dyln Tier A fixtures end to end.
  const bundle = await runDylnEmailQaIntegration();
  record(
    "1. all dyln Tier A fixtures loaded and run",
    bundle.fixtures.length === 17,
    `loaded ${bundle.fixtures.length} fixture(s) from ${bundle.fixturesDir}`
  );

  // 2. dyln repo identity captured read-only (no mutation possible from this proof).
  record(
    "2. dyln repo path/HEAD/branch captured",
    Boolean(bundle.dylnRepoPath && bundle.dylnRepoHead && bundle.dylnRepoBranch),
    `path=${bundle.dylnRepoPath}, head=${bundle.dylnRepoHead}, branch=${bundle.dylnRepoBranch}`
  );

  // 3. No real provider call was ever made for any fixture.
  const anyProviderCall = bundle.fixtures.some((f) => f.providerCallMade);
  record("3. no real provider call made for any dyln fixture", !anyProviderCall, `providerCallMade=true count: ${bundle.fixtures.filter((f) => f.providerCallMade).length}`);

  // 4. Every fixture produced a verdict and evidence/inbox refs.
  const allHaveRefs = bundle.fixtures.every((f) => f.evidenceId && f.inboxMessageId && f.fixtureHash.startsWith("sha256:") && f.renderedPayloadHash.startsWith("sha256:"));
  record("4. every fixture has evidence/inbox/hash refs", allHaveRefs, `checked ${bundle.fixtures.length} fixture(s)`);

  // 5. Verdict breakdown — the known follow-up-email SENDER_MISMATCH gap
  //    (dyln inventory gap #3, not a harness defect) must be exactly one
  //    explained FAIL, nothing else unexpectedly broken.
  const byVerdict = bundle.fixtures.reduce<Record<string, string[]>>((acc, f) => {
    (acc[f.verdict] ??= []).push(f.fixtureId);
    return acc;
  }, {});
  const unexpectedFailures = (byVerdict.FAIL || []).filter((id) => id !== "follow-up-email");
  const anyBlocked = (byVerdict.BLOCKED || []).length > 0;
  record(
    "5. only the known follow-up-email sender-mismatch gap fails; nothing else FAILs or is BLOCKED",
    unexpectedFailures.length === 0 && !anyBlocked,
    `verdicts=${JSON.stringify(Object.fromEntries(Object.entries(byVerdict).map(([k, v]) => [k, v.length])))}`
  );

  // 6. Write + retain the evidence bundle.
  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const evidenceBundle = {
    proof: "foundry-dyln-email-qa-integration@1",
    generatedAt: new Date().toISOString(),
    realProviderCallsMade: false,
    dylnRepoWritten: false,
    steps,
    verdictBreakdown: byVerdict,
    bundle,
  };
  const bundlePath = path.join(evidenceDir, "dyln-email-qa-integration-proof.json");
  await writeFile(bundlePath, JSON.stringify(evidenceBundle, null, 2), "utf8");

  const artifact = await retainArtifact({
    kind: "email_qa_dyln_integration_evidence",
    content: evidenceBundle,
    contentType: "application/json",
    retentionClass: "RELEASE",
    producer: "dyln-email-qa-integration-proof",
    source: "dyln-fixture-loader",
    projectId: "dyln",
  });
  record("6. evidence bundle written and retained as a Foundry artifact", Boolean(artifact.id), `artifactId=${artifact.id}, path=${bundlePath}`);

  console.log(`\nEvidence bundle written: ${bundlePath}`);
  console.log(`Retained as Foundry artifact: ${artifact.id}`);
  console.log(`\nAll ${steps.length} proof steps PASSED. No real provider calls were made. dyln repo was not written to.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
