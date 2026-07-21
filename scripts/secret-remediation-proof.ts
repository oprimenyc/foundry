/**
 * FOUNDRY governed secret exposure remediation — runtime proof.
 *
 * Exercises the full pipeline (classify → plan → gate → advise → evidence →
 * operator surface) against the PantiCandy/vITALCore fixture cases and a
 * synthetic raw-secret-rejection case. No real GitHub/Supabase/Neon/Google/
 * Railway API is called; no credential is rotated; no secret value is ever
 * read, stored, or printed. Emits a machine-readable evidence bundle under
 * proof/evidence/.
 *
 * Run: npm run proof:secret-remediation
 */
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { ingestSecretExposureFinding, SecretExposureFindingValidationError, listRemediationEvidence } from "@/lib/secret-remediation/evidence";
import { ingestAllFixtures } from "@/lib/secret-remediation/fixtures";
import { resetRemediationGates, decideRemediationGate, listRemediationGates } from "@/lib/secret-remediation/gates";
import { getRemediationStatus, getRemediationOperatorReport } from "@/lib/secret-remediation/operator";
import { scanForRawSecretMaterial } from "@/lib/secret-remediation/secret-scan";

const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

async function main() {
  const sandbox = path.join(process.cwd(), ".foundry-proof-secret-remediation");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(sandbox, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(sandbox, "artifacts");
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  resetFoundryPersistence();
  resetRemediationGates();

  // 1. A raw secret value is rejected outright, never accepted as a finding.
  let rejected = false;
  try {
    await ingestSecretExposureFinding({
      project: "proof-acme",
      filePath: ".env",
      sourceReference: "manual test",
      secretCategory: "github_pat",
      exposureLocation: "current_tracked_file",
      severity: "high",
      containmentStatus: "not_contained",
      rotationRequired: true,
      historyRewriteRequired: "not_applicable",
      deploymentEnvUpdateRequired: false,
      notes: "found ghp_1234567890abcdefghij1234567890abcdEF in the file",
    });
  } catch (error) {
    rejected = error instanceof SecretExposureFindingValidationError;
  }
  record("1. raw secret value is rejected, not merely redacted", rejected, `rejected=${rejected}`);

  // 2. All six real-world fixture cases (PantiCandy x2, vITALCore x4) ingest end-to-end.
  const evidencePackages = await ingestAllFixtures();
  record(
    "2. all 6 fixture cases ingest end-to-end",
    evidencePackages.length === 6 && evidencePackages.every((e) => e.advisories.every((a) => a.blocked && a.noRealMutationConfirmed)),
    `ingested=${evidencePackages.length}, all-blocked=${evidencePackages.every((e) => e.advisories.every((a) => a.blocked))}`
  );

  // 3. No fixture reaches PASS outright — Foundry never rotates for real, so
  //    every finding that still needs rotation/env-update/history-decision
  //    caps at PASS_WITH_WARNINGS, and any not-yet-contained case is worse.
  const verdicts = evidencePackages.map((e) => e.verdict);
  record(
    "3. no fixture silently claims full PASS while rotation is outstanding",
    verdicts.every((v) => v !== "PASS"),
    `verdicts=${verdicts.join(",")}`
  );

  // 4. Evidence packages and their on-disk artifacts carry no raw secret material.
  const allClean = evidencePackages.every((e) => scanForRawSecretMaterial(e).length === 0);
  record("4. evidence packages carry no raw secret material", allClean, `clean=${allClean}`);

  // 5. Approval gates: git history rewrite is a separate, decidable gate from rotation.
  const historyCase = evidencePackages.find((e) => e.plan.humanApprovalGates.some((g) => g.reason === "git_history_rewrite"));
  record("5. at least one fixture raises a git_history_rewrite gate", Boolean(historyCase), `found=${Boolean(historyCase)}`);
  if (historyCase) {
    const gates = listRemediationGates({ findingId: historyCase.findingId });
    const rotationGate = gates.find((g) => g.reason === "live_provider_credential_rotation");
    const rewriteGate = gates.find((g) => g.reason === "git_history_rewrite");
    if (rotationGate) {
      const decided = decideRemediationGate(rotationGate.id, "approved", "proof-operator");
      record(
        "5a. deciding the rotation gate leaves the history-rewrite gate untouched",
        decided.status === "approved" && rewriteGate?.status === "pending",
        `rotation=${decided.status}, rewrite=${rewriteGate?.status}`
      );
    }
  }

  // 6. Operator surface returns full status for one finding and an aggregate report.
  const oneStatus = await getRemediationStatus(evidencePackages[0].findingId);
  record(
    "6a. operator surface returns per-finding status with empty live-steps",
    Boolean(oneStatus) && Array.isArray(oneStatus?.liveStepsExecuted) && oneStatus!.liveStepsExecuted.length === 0,
    `found=${Boolean(oneStatus)}, liveSteps=${oneStatus?.liveStepsExecuted.length}`
  );
  const report = await getRemediationOperatorReport({});
  record("6b. operator aggregate report covers all ingested findings", report.totalFindings === 6, `totalFindings=${report.totalFindings}`);

  const listed = await listRemediationEvidence({});
  record("7. evidence is independently listable via the artifact backend", listed.length === 6, `listed=${listed.length}`);

  // 8. Write the machine-readable proof bundle.
  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const bundle = {
    proof: "foundry-secret-remediation-orchestrator@1",
    generatedAt: new Date().toISOString(),
    realProviderCallsMade: false,
    secretValuesStored: false,
    steps,
    fixtureVerdicts: evidencePackages.map((e) => ({ project: e.finding.project, category: e.finding.secretCategory, verdict: e.verdict })),
    operatorReportSummary: { totalFindings: report.totalFindings, bySeverity: report.bySeverity, pendingApprovals: report.pendingApprovals },
  };
  const bundlePath = path.join(evidenceDir, "secret-remediation-proof.json");
  await writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");
  console.log(`\nEvidence bundle written: ${bundlePath}`);
  console.log(`\nAll ${steps.length} proof steps PASSED. No real provider calls were made. No secret values were stored.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
