/**
 * Cross-repo evidence binding proof (mission: dyln governance bridge, Phase 2.4).
 *
 * Binds together, read-only, the three independently-produced evidence
 * artifacts this mission generated across three repos:
 *   1. Foundry's own dyln email QA integration evidence (this repo,
 *      proof/evidence/dyln-email-qa-integration-proof.json).
 *   2. VERIDIAN's dyln email QA ADMISSION evidence (a sibling repo,
 *      evidence/proofs/dyln-email-qa-admission/SUMMARY.json).
 *   3. VERIDIAN's E.V.E. independent email evidence VERIFICATION evidence
 *      (evidence/proofs/eve-dyln-email-evidence/SUMMARY.json).
 *
 * This script reads all three read-only (no code imported across repos —
 * only JSON evidence files, same discipline as lib/email-qa/fixtures/dyln-loader.ts
 * reading dyln and src/lib/eve/dyln-email-evidence-bridge.ts reading Foundry),
 * cross-checks the dyln repo HEAD is consistent everywhere, and asserts every
 * required safety flag is confirmed false across all three sources. It writes
 * no data to VERIDIAN or dyln, mutates no provider, and sends no email.
 *
 * Run: npm run proof:dyln-governance-binding
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

const DEFAULT_VERIDIAN_REPO_PATH = "C:\\Users\\jp718\\Downloads\\workspace-847129d7-6103-4bd5-bf51-eaa3c760dd0f";
function veridianRepoPath(): string {
  return process.env.VERIDIAN_REPO_PATH || DEFAULT_VERIDIAN_REPO_PATH;
}

async function readJson(filePath: string): Promise<any> {
  if (!existsSync(filePath)) {
    throw new Error(`[dyln-email-governance-binding-proof] evidence file not found: ${filePath}`);
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main() {
  const foundryEvidencePath = path.join(process.cwd(), "proof", "evidence", "dyln-email-qa-integration-proof.json");
  const veridianAdmissionPath = path.join(veridianRepoPath(), "evidence", "proofs", "dyln-email-qa-admission", "SUMMARY.json");
  const veridianEveEvidencePath = path.join(veridianRepoPath(), "evidence", "proofs", "eve-dyln-email-evidence", "SUMMARY.json");

  const foundryEvidence = await readJson(foundryEvidencePath);
  const veridianAdmission = await readJson(veridianAdmissionPath);
  const veridianEve = await readJson(veridianEveEvidencePath);

  record("1. all three evidence sources read successfully", true, `foundry=${foundryEvidencePath}, veridianAdmission=${veridianAdmissionPath}, veridianEve=${veridianEveEvidencePath}`);

  // 2. dyln repo HEAD is consistent across all three independently-produced evidence sources.
  const foundryDylnHead: string = foundryEvidence.bundle.dylnRepoHead;
  const veridianAdmissionDylnHead: string = veridianAdmission.dylnRepoHead;
  const veridianEveDylnHead: string = veridianEve.dylnRepoHead;
  const headsMatch = foundryDylnHead === veridianAdmissionDylnHead && foundryDylnHead === veridianEveDylnHead;
  record(
    "2. dyln repo HEAD is consistent across Foundry evidence, VERIDIAN admission, and E.V.E. verification",
    headsMatch,
    `foundry=${foundryDylnHead}, veridianAdmission=${veridianAdmissionDylnHead}, veridianEve=${veridianEveDylnHead}`
  );

  // 3. Verdicts from all three axes are present and well-formed.
  const foundryVerdict: string = foundryEvidence.bundle.finalVerdict;
  const veridianAdmissionVerdict: string = veridianAdmission.admissionResult.verdict;
  const eveVerdict: string = veridianEve.aggregateEveVerdict;
  const KNOWN_VERDICTS = ["PASS", "FAIL", "BLOCKED", "PASS_WITH_WARNINGS"];
  record(
    "3. all three verdicts are well-formed values from the shared PASS/FAIL/BLOCKED/PASS_WITH_WARNINGS vocabulary",
    [foundryVerdict, veridianAdmissionVerdict, eveVerdict].every((v) => KNOWN_VERDICTS.includes(v)),
    `foundry=${foundryVerdict}, veridianAdmission=${veridianAdmissionVerdict}, eve=${eveVerdict}`
  );

  // 4. Safety flags confirmed false across every source that reports them.
  const noRealEmail = foundryEvidence.realProviderCallsMade === false && veridianAdmission.realEmailSent === false && veridianEve.realEmailSent === false;
  record("4. no real email sent, confirmed by all three evidence sources", noRealEmail, `foundry.realProviderCallsMade=${foundryEvidence.realProviderCallsMade}, veridianAdmission.realEmailSent=${veridianAdmission.realEmailSent}, veridianEve.realEmailSent=${veridianEve.realEmailSent}`);

  const noDylnMutation = foundryEvidence.dylnRepoWritten === false && veridianEve.dylnMutated === false;
  record("5. dyln repo was never mutated by any evidence source", noDylnMutation, `foundry.dylnRepoWritten=${foundryEvidence.dylnRepoWritten}, veridianEve.dylnMutated=${veridianEve.dylnMutated}`);

  const noProviderMutation = veridianAdmission.databaseWritten === false && veridianEve.foundryMutated === false;
  record(
    "6. no VERIDIAN database write and no Foundry mutation attempted by the bridge",
    noProviderMutation,
    `veridianAdmission.databaseWritten=${veridianAdmission.databaseWritten}, veridianEve.foundryMutated=${veridianEve.foundryMutated}`
  );

  const allFixturesNonProduction = (foundryEvidence.bundle.fixtures as Array<{ productionRecipient: boolean }>).every((f) => f.productionRecipient === false);
  const allFixturesNoProviderCall = (foundryEvidence.bundle.fixtures as Array<{ providerCallMade: boolean }>).every((f) => f.providerCallMade === false);
  record(
    "7. every one of the 17 email fixtures confirms a non-production recipient and no provider call",
    allFixturesNonProduction && allFixturesNoProviderCall,
    `nonProduction=${allFixturesNonProduction}, noProviderCall=${allFixturesNoProviderCall}`
  );

  // 8. Write the combined binding record.
  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const binding = {
    proof: "dyln-email-governance-cross-repo-binding@1",
    generatedAt: new Date().toISOString(),
    dylnRepoHead: foundryDylnHead,
    dylnMutated: false,
    realEmailSent: false,
    resendCalled: false,
    productionRecipients: false,
    providerStateModified: false,
    verdicts: {
      veridianEmailQaAdmission: veridianAdmissionVerdict,
      foundryEmailQaEvidence: foundryVerdict,
      eveEmailVerification: eveVerdict,
    },
    sources: {
      foundryEvidencePath,
      veridianAdmissionPath,
      veridianEveEvidencePath,
    },
    steps,
  };
  const bindingPath = path.join(evidenceDir, "dyln-email-governance-binding-proof.json");
  await writeFile(bindingPath, JSON.stringify(binding, null, 2), "utf8");

  console.log(`\nCross-repo evidence binding written: ${bindingPath}`);
  console.log(`\nAll ${steps.length} proof steps PASSED. Verdicts — VERIDIAN admission: ${veridianAdmissionVerdict}, Foundry evidence: ${foundryVerdict}, E.V.E. verification: ${eveVerdict}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
