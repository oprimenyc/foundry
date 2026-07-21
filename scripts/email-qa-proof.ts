/**
 * FOUNDRY free/local email QA harness proof.
 *
 * Exercises the harness end-to-end on local fixtures only — no real Resend
 * call, no real customer email, no DNS mutation. Emits a machine-readable
 * evidence bundle under proof/evidence/.
 *
 * Run: npm run proof:email-qa
 */
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { validateProductEmailConfig } from "@/lib/email-qa/validate";
import { runEmailQaAndProduceEvidence } from "@/lib/email-qa/evidence";
import { listInboxMessages } from "@/lib/email-qa/inbox";
import { LocalFixtureAdapter } from "@/lib/email-qa/adapters/local-fixture.adapter";
import { ResendQaAdapter, liveResendSendExplicitlyEnabled } from "@/lib/email-qa/adapters/resend-boundary.adapter";
import { DYLN_EMAIL_CONFIG } from "@/lib/email-qa/fixtures/dyln.config";
import type { EmailPayload } from "@/lib/email-qa/types";

const steps: Array<{ step: string; status: "PASS" | "FAIL"; detail: string }> = [];
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "✓" : "✗"} ${step} — ${detail}`);
  if (!ok) throw new Error(`Proof step failed: ${step} — ${detail}`);
}

function dylnWelcomePayload(): EmailPayload {
  return {
    productId: "dyln",
    emailType: "welcome",
    recipient: { type: "customer", address: "qa+welcome@dyln.test" },
    from: "support@getdyln.com",
    subject: "Welcome to DYLN",
    templateInputs: { firstName: "QA" },
    renderedBody: "Hi QA, welcome to DYLN! Go to your Dashboard: https://app.getdyln.com/dashboard | " + "https://getdyln.com/unsubscribe",
    requiredLinks: ["/dashboard", "https://getdyln.com/unsubscribe"],
    requiredAssets: [],
    headers: { "X-QA-Fixture": "true" },
  };
}

async function main() {
  const sandbox = path.join(process.cwd(), ".foundry-proof-email-qa");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(sandbox, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(sandbox, "artifacts");
  delete process.env.FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND;
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(sandbox, { recursive: true });
  resetFoundryPersistence();

  // 1. Confirmed dyln product config validates.
  const configCheck = validateProductEmailConfig(DYLN_EMAIL_CONFIG);
  record("1. dyln confirmed config validates", configCheck.ok, `ok=${configCheck.ok}, issues=${configCheck.issues.length}`);

  // 2. Valid email passes, dispatched through the local fixture adapter (no network, no cost).
  const passEvidence = await runEmailQaAndProduceEvidence(DYLN_EMAIL_CONFIG, dylnWelcomePayload(), {
    adapter: new LocalFixtureAdapter(),
    dispatch: true,
  });
  record(
    "2. valid welcome email passes via local fixture adapter",
    passEvidence.verdict === "PASS" && passEvidence.deliveryCorrelation?.simulated === true,
    `verdict=${passEvidence.verdict}, mode=${passEvidence.deliveryCorrelation?.mode}, simulated=${passEvidence.deliveryCorrelation?.simulated}`
  );

  // 3. Broken email (unresolved placeholder + missing vars) on a real
  //    revenue-critical (-> release-blocking) dyln email type is BLOCKED, not
  //    merely FAIL. "password_reset" isn't one of dyln's 17 real Tier A
  //    fixture-covered types (it's Firebase-hosted, Tier B) — use
  //    payment-confirmed, which is.
  const brokenPayload = dylnWelcomePayload();
  brokenPayload.emailType = "payment-confirmed";
  brokenPayload.templateInputs = {}; // missing required firstName/amount/description/dateStr
  brokenPayload.renderedBody = "Hi {{firstName}}, payment confirmed: {{amount}}"; // unresolved + no footer link
  brokenPayload.requiredLinks = [];
  const blockedEvidence = await runEmailQaAndProduceEvidence(DYLN_EMAIL_CONFIG, brokenPayload);
  record(
    "3. broken release-blocking email is BLOCKED",
    blockedEvidence.verdict === "BLOCKED",
    `verdict=${blockedEvidence.verdict}, unresolved=${blockedEvidence.placeholderCheck.unresolved.join(",")}`
  );

  // 4. Virtual inbox actually has both messages.
  const inbox = await listInboxMessages({ productId: "dyln" });
  record("4. virtual inbox stores messages", inbox.length === 2, `stored ${inbox.length} message(s)`);

  // 5. Resend boundary never calls the real provider without both explicit gates.
  let liveCalled = false;
  const stubClient = { sendEmail: async () => { liveCalled = true; return { id: "proof-should-not-run" }; } } as never;
  const defaultResendAdapter = new ResendQaAdapter({ apiKey: "re_proof_key", client: stubClient });
  await defaultResendAdapter.send(dylnWelcomePayload());
  record(
    "5a. Resend boundary defaults to simulated, no real call",
    defaultResendAdapter.mode === "resend-test" && !liveCalled,
    `mode=${defaultResendAdapter.mode}, liveCalled=${liveCalled}`
  );

  process.env.FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND = "explicit-live-send";
  const liveResendAdapter = new ResendQaAdapter({ apiKey: "re_proof_key", allowLiveSend: true, client: stubClient });
  const liveSend = await liveResendAdapter.send(dylnWelcomePayload());
  record(
    "5b. Resend boundary calls provider only with both explicit gates set",
    liveCalled && liveResendAdapter.mode === "resend-live" && liveSend.simulated === false && liveResendSendExplicitlyEnabled(),
    `mode=${liveResendAdapter.mode}, liveCalled=${liveCalled}, simulated=${liveSend.simulated}`
  );
  delete process.env.FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND;

  // 6. Write the machine-readable proof bundle.
  const evidenceDir = path.join(process.cwd(), "proof", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const bundle = {
    proof: "foundry-email-qa-harness@1",
    generatedAt: new Date().toISOString(),
    realProviderCallsMade: false,
    steps,
    sampleEvidence: { pass: passEvidence, blocked: blockedEvidence },
  };
  const bundlePath = path.join(evidenceDir, "email-qa-proof.json");
  await writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");
  console.log(`\nEvidence bundle written: ${bundlePath}`);
  console.log(`\nAll ${steps.length} proof steps PASSED. No real provider calls were made.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
