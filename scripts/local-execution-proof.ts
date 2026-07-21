/**
 * FOUNDRY local execution evidence adapter — runtime proof (Phase 1, mission:
 * dyln governance bridge).
 *
 * Exercises the full pipeline (ingest → policy → retain → operator surface)
 * against all six required fixtures: two tools blocked pending
 * install/environment issues, one slow-but-real CPU-only local model run,
 * one clean PrimeOS-tier proof, one blocked provider-mutation attempt, and
 * one blocked secret-exposure attempt. No local worker is ever executed by
 * this proof — every fixture is a pre-recorded evidence submission.
 *
 * Run: npm run proof:local-execution
 */
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { recordLocalExecutionEvidence } from "@/lib/local-execution/evidence";
import { getLocalExecutionOperatorReport } from "@/lib/local-execution/operator";
import { loadLocalExecutionEvidenceFile } from "@/lib/local-execution/ingest";
import { localExecutionFixturePath } from "@/lib/local-execution/fixtures";
import { scanForRawSecretMaterial } from "@/lib/secret-remediation/secret-scan";

const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

const EXPECTED = [
  { file: "jcode-blocked.fixture.json", status: "accepted", verdict: "BLOCKED" },
  { file: "wigolo-blocked.fixture.json", status: "accepted", verdict: "BLOCKED" },
  { file: "ollama-cpu-slow.fixture.json", status: "accepted", verdict: "PASS_WITH_WARNINGS" },
  { file: "primeos-tier-proof.fixture.json", status: "accepted", verdict: "PASS" },
  { file: "blocked-provider-mutation.fixture.json", status: "accepted", verdict: "BLOCKED" },
  { file: "blocked-secret-exposure.fixture.json", status: "rejected", verdict: null },
] as const;

async function main() {
  const sandbox = path.join(process.cwd(), ".foundry-proof-local-execution");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(sandbox, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(sandbox, "artifacts");
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  resetFoundryPersistence();

  const outcomes: Array<{ file: string; status: string; verdict: string | null; artifactId: string; rejectionReason?: string }> = [];

  for (const expected of EXPECTED) {
    const raw = await loadLocalExecutionEvidenceFile(localExecutionFixturePath(expected.file));
    const { result, artifactId } = await recordLocalExecutionEvidence(raw, { source: `fixture:${expected.file}` });
    const actualVerdict = result.status === "accepted" ? result.record.verdict : null;
    outcomes.push({
      file: expected.file,
      status: result.status,
      verdict: actualVerdict,
      artifactId,
      rejectionReason: result.status === "rejected" ? result.reason : undefined,
    });
    record(
      `fixture ${expected.file}: status=${expected.status}, verdict=${expected.verdict ?? "n/a"}`,
      result.status === expected.status && actualVerdict === expected.verdict,
      `got status=${result.status}, verdict=${actualVerdict ?? "n/a"}${result.status === "rejected" ? `, reason=${result.reason}` : ""}`
    );
  }

  // No real provider mutation, no real secret material, ever.
  const anyProviderMutationApplied = outcomes.some((o) => o.file === "blocked-provider-mutation.fixture.json" && o.verdict !== "BLOCKED");
  record("no unapproved provider mutation was ever treated as authorized", !anyProviderMutationApplied, `providerMutationTreatedAsAuthorized=${anyProviderMutationApplied}`);

  const secretRejection = outcomes.find((o) => o.file === "blocked-secret-exposure.fixture.json");
  record(
    "secret-exposure fixture was rejected at ingest, never turned into a reviewable evidence record",
    secretRejection?.status === "rejected" && secretRejection?.rejectionReason === "secret_exposure_detected",
    `status=${secretRejection?.status}, reason=${secretRejection?.rejectionReason}`
  );

  // Operator surface aggregates all six submissions with correct verdict tallies.
  const report = await getLocalExecutionOperatorReport({});
  record(
    "operator report covers all 6 submissions (5 accepted + 1 rejected)",
    report.totalSubmissions === 6 && report.accepted === 5 && report.rejected === 1,
    `total=${report.totalSubmissions}, accepted=${report.accepted}, rejected=${report.rejected}`
  );
  record(
    "operator report verdict tally matches expected (3 BLOCKED, 1 PASS_WITH_WARNINGS, 1 PASS)",
    report.byVerdict.BLOCKED === 3 && report.byVerdict.PASS_WITH_WARNINGS === 1 && report.byVerdict.PASS === 1 && report.byVerdict.FAIL === 0,
    `byVerdict=${JSON.stringify(report.byVerdict)}`
  );
  record("operator report flags the pending provider-mutation-approval escalation", report.pendingEscalations >= 1, `pendingEscalations=${report.pendingEscalations}`);

  // Every accepted record still marks itself as requiring independent (E.V.E.) verification.
  const allRequireIndependentVerification = report.entries.filter((e) => e.status === "accepted").every((e) => e.requiresIndependentVerification);
  record("every accepted record requires independent verification, never treated as final authority", allRequireIndependentVerification, `ok=${allRequireIndependentVerification}`);

  // No raw secret material anywhere in what was retained.
  const allClean = outcomes.every((o) => scanForRawSecretMaterial(o).length === 0);
  record("no raw secret material present in any retained outcome", allClean, `clean=${allClean}`);

  // Write the machine-readable proof bundle.
  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const bundle = {
    proof: "foundry-local-execution-evidence-adapter@1",
    generatedAt: new Date().toISOString(),
    realWorkersExecuted: false,
    realProviderCallsMade: false,
    secretValuesStored: false,
    steps,
    outcomes,
    operatorReportSummary: {
      totalSubmissions: report.totalSubmissions,
      accepted: report.accepted,
      rejected: report.rejected,
      byVerdict: report.byVerdict,
      pendingEscalations: report.pendingEscalations,
    },
  };
  const bundlePath = path.join(evidenceDir, "local-execution-evidence-proof.json");
  await writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");
  console.log(`\nEvidence bundle written: ${bundlePath}`);
  console.log(`\nAll ${steps.length} proof steps PASSED. No local worker was executed by this proof; no real provider call was made.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
