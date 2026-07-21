/**
 * FOUNDRY approval-gated provider action adapter — runtime proof (mission:
 * provider action adapter mega run).
 *
 * Exercises the full pipeline (validate -> classify -> resolve adapter ->
 * raise gates -> advise -> policy -> retain -> operator surface) against all
 * ten required fixtures, plus the gate-decision lifecycle on one of them.
 * No live provider call is ever made by this proof — every fixture is a
 * dry-run/advisory plan; nothing here rotates, revokes, updates, restarts,
 * redeploys, or touches DNS/history for real.
 *
 * Run: npm run proof:provider-actions
 */
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { ingestProviderActionRequest } from "@/lib/provider-actions/evidence";
import { decideProviderActionGate, listProviderActionGates, resetProviderActionGates } from "@/lib/provider-actions/gates";
import { getProviderActionOperatorReport, getProviderActionStatus } from "@/lib/provider-actions/operator";
import { providerActionFixturePath, PROVIDER_ACTION_FIXTURE_FILES } from "@/lib/provider-actions/fixtures";
import { scanForRawSecretMaterial } from "@/lib/secret-remediation/secret-scan";

const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

const EXPECTED: Record<string, string> = {
  "panticandy-github-pat-revocation.fixture.json": "BLOCKED",
  "panticandy-db-credential-rotation.fixture.json": "BLOCKED",
  "vitalcore-nextauth-secret-regeneration.fixture.json": "BLOCKED",
  "vitalcore-google-oauth-rotation.fixture.json": "BLOCKED",
  "vitalcore-db-credential-rotation.fixture.json": "BLOCKED",
  "dyln-staging-env-update-advisory.fixture.json": "BLOCKED",
  "primeopp-domain-env-deployment-advisory.fixture.json": "PASS_WITH_WARNINGS",
  "railway-staging-env-update-dryrun.fixture.json": "BLOCKED",
  "fly-health-verification-dryrun.fixture.json": "PASS",
  "vercel-missing-cli-blocked-advisory.fixture.json": "BLOCKED",
};

async function main() {
  const sandbox = path.join(process.cwd(), ".foundry-proof-provider-actions");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(sandbox, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(sandbox, "artifacts");
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  resetFoundryPersistence();
  resetProviderActionGates();

  const outcomes: Array<{ file: string; verdict: string; actionId: string; evidenceId: string; requiredApprovalGates: string[] }> = [];

  for (const file of PROVIDER_ACTION_FIXTURE_FILES) {
    const raw = JSON.parse(await readFile(providerActionFixturePath(file), "utf8"));
    const secretMatches = scanForRawSecretMaterial(raw);
    record(`fixture ${file}: contains no secret-shaped material`, secretMatches.length === 0, `matches=${secretMatches.length}`);

    const { evidence } = await ingestProviderActionRequest(raw);
    outcomes.push({ file, verdict: evidence.verdict, actionId: evidence.actionId, evidenceId: evidence.evidenceId, requiredApprovalGates: evidence.policy.requiredApprovalGates });
    record(`fixture ${file}: verdict=${EXPECTED[file]}`, evidence.verdict === EXPECTED[file], `got verdict=${evidence.verdict}`);
    record(`fixture ${file}: no live call made`, evidence.advisory.liveCallMade === false && evidence.dryRunResult.liveCallMade === false, `advisory.liveCallMade=${evidence.advisory.liveCallMade}`);
  }

  // Operator report aggregates all ten submissions with the correct verdict tally.
  const report = await getProviderActionOperatorReport({});
  record(
    "operator report covers all 10 fixtures (8 BLOCKED, 1 PASS_WITH_WARNINGS, 1 PASS, 0 FAIL)",
    report.totalActions === 10 && report.byVerdict.BLOCKED === 8 && report.byVerdict.PASS_WITH_WARNINGS === 1 && report.byVerdict.PASS === 1 && report.byVerdict.FAIL === 0,
    `byVerdict=${JSON.stringify(report.byVerdict)}`
  );
  record("operator report confirms no real provider calls were made", report.realProviderCallsMade === false, `realProviderCallsMade=${report.realProviderCallsMade}`);

  // Approval-gate lifecycle: approve every gate on the Railway staging dry-run fixture and
  // confirm the operator surface reflects it live, while the retained evidence stays frozen.
  const railwayOutcome = outcomes.find((o) => o.file === "railway-staging-env-update-dryrun.fixture.json")!;
  const gatesBefore = listProviderActionGates({ actionId: railwayOutcome.actionId });
  record("Railway staging dry-run: gates raised pending, matching requiredApprovalGates", gatesBefore.every((g) => g.status === "pending") && gatesBefore.length === railwayOutcome.requiredApprovalGates.length, `gates=${gatesBefore.length}`);
  for (const gate of gatesBefore) decideProviderActionGate(gate.id, "approved", "proof-script-operator");
  const statusAfter = await getProviderActionStatus(railwayOutcome.actionId);
  record("Railway staging dry-run: operator surface reflects live-approved gates", Boolean(statusAfter?.approvalState.every((g) => g.status === "approved")), `approvalState=${JSON.stringify(statusAfter?.approvalState.map((g) => g.status))}`);
  record("Railway staging dry-run: frozen evidence verdict is unchanged by the later gate decision", statusAfter?.verdict === "BLOCKED", `verdict=${statusAfter?.verdict}`);
  record(
    "a fresh submission of the same plan with the gates pre-approved reaches PASS_WITH_WARNINGS, never a plain PASS",
    await (async () => {
      const raw = JSON.parse(await readFile(providerActionFixturePath("railway-staging-env-update-dryrun.fixture.json"), "utf8"));
      const { evidence } = await ingestProviderActionRequest({ ...raw, preApprovedGateReasons: ["live_provider_mutation", "deployment_env_mutation"] });
      return evidence.verdict === "PASS_WITH_WARNINGS";
    })(),
    "demonstrates the mutation-required-action ceiling: approved is never enough for a plain PASS"
  );

  // No raw secret material anywhere in what was retained.
  const allClean = outcomes.every((o) => scanForRawSecretMaterial(o).length === 0);
  record("no raw secret material present in any retained outcome", allClean, `clean=${allClean}`);

  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const bundle = {
    proof: "foundry-provider-action-adapter@1",
    generatedAt: new Date().toISOString(),
    realProviderCallsMade: false,
    liveCredentialsRotated: false,
    liveCredentialsRevoked: false,
    deploymentEnvMutated: false,
    servicesRestarted: false,
    deploysTriggered: false,
    dnsModified: false,
    gitHistoryRewritten: false,
    secretValuesStored: false,
    steps,
    outcomes,
    operatorReportSummary: {
      totalActions: report.totalActions,
      byVerdict: report.byVerdict,
      pendingApprovals: report.pendingApprovals,
    },
  };
  const bundlePath = path.join(evidenceDir, "provider-action-adapter-proof.json");
  await writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");
  console.log(`\nEvidence bundle written: ${bundlePath}`);
  console.log(`\nAll ${steps.length} proof steps PASSED. No live provider call was made by any of the ${outcomes.length} action plans.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
