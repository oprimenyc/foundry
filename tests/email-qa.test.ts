import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { validateProductEmailConfig, runEmailQaValidation } from "@/lib/email-qa/validate";
import { runEmailQaAndProduceEvidence } from "@/lib/email-qa/evidence";
import { listInboxMessages } from "@/lib/email-qa/inbox";
import { LocalFixtureAdapter } from "@/lib/email-qa/adapters/local-fixture.adapter";
import { ResendQaAdapter, liveResendSendExplicitlyEnabled, type ResendQaAdapterOptions } from "@/lib/email-qa/adapters/resend-boundary.adapter";
import { DYLN_SAMPLE_EMAIL_CONFIG } from "@/lib/email-qa/fixtures/dyln.sample-config";
import type { EmailPayload, ProductEmailConfig } from "@/lib/email-qa/types";

const testDir = path.join(process.cwd(), ".foundry-test-data", "email-qa");

async function resetEnv() {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_STORE_FILE = path.join(testDir, "store.json");
  process.env.FOUNDRY_ARTIFACT_DIR = path.join(testDir, "artifacts");
  delete process.env.FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND;
  resetFoundryPersistence();
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });
}

function baseConfig(overrides: Partial<ProductEmailConfig> = {}): ProductEmailConfig {
  return {
    productId: "acme",
    productName: "Acme",
    sample: false,
    sender: { fromAddress: "no-reply@acme.example", fromName: "Acme", replyTo: "support@acme.example" },
    allowedFromDomains: ["acme.example"],
    emailTypes: [
      { id: "welcome", description: "welcome email", criticality: "standard", releaseBlocking: false, requiredTemplateVars: ["name"] },
      { id: "password_reset", description: "password reset", criticality: "release-blocking", releaseBlocking: true, requiredTemplateVars: ["resetLink"] },
    ],
    requiredFooterLinks: ["https://acme.example/unsubscribe"],
    requiredLegalText: [],
    releaseBlockingRules: {
      requireNoUnresolvedPlaceholders: true,
      requireAllLinksResolve: true,
      requireSenderMatch: true,
      requireReplyToMatch: true,
      missingAssetSeverity: "warning",
    },
    ...overrides,
  };
}

function basePayload(overrides: Partial<EmailPayload> = {}): EmailPayload {
  return {
    productId: "acme",
    emailType: "welcome",
    recipient: { type: "customer", address: "jane@example.com" },
    from: "no-reply@acme.example",
    fromName: "Acme",
    replyTo: "support@acme.example",
    subject: "Welcome to Acme",
    templateInputs: { name: "Jane" },
    renderedBody: "Hi Jane, welcome! Manage preferences: https://acme.example/unsubscribe",
    requiredLinks: [],
    requiredAssets: [],
    headers: {},
    ...overrides,
  };
}

test("valid local email passes", async () => {
  await resetEnv();
  const config = baseConfig();
  const payload = basePayload();
  const evidence = await runEmailQaAndProduceEvidence(config, payload);
  assert.equal(evidence.verdict, "PASS");
  assert.equal(evidence.validation.ok, true);
  assert.ok(evidence.evidenceId);
  assert.ok(evidence.inboxMessageId);
});

test("missing sender fails", async () => {
  await resetEnv();
  const config = baseConfig();
  const payload = basePayload({ from: "someone@unrelated.example" });
  const result = runEmailQaValidation(config, payload);
  assert.equal(result.ok, false);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.checks.sender.issues.some((i) => i.code === "SENDER_MISMATCH"));
  assert.ok(result.checks.sender.issues.some((i) => i.code === "SENDER_DOMAIN_NOT_ALLOWED"));
});

test("missing sender on a release-blocking email type is BLOCKED, not FAIL", async () => {
  await resetEnv();
  const config = baseConfig();
  const payload = basePayload({ emailType: "password_reset", templateInputs: { resetLink: "https://acme.example/reset/123" }, from: "someone@unrelated.example" });
  const result = runEmailQaValidation(config, payload);
  assert.equal(result.verdict, "BLOCKED");
});

test("unresolved placeholder fails", async () => {
  await resetEnv();
  const config = baseConfig();
  const payload = basePayload({ renderedBody: "Hi {{customerFirstName}}, welcome! https://acme.example/unsubscribe" });
  const result = runEmailQaValidation(config, payload);
  assert.equal(result.ok, false);
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(result.checks.placeholders.unresolved, ["{{customerFirstName}}"]);
});

test("wrong reply-to fails", async () => {
  await resetEnv();
  const config = baseConfig();
  const payload = basePayload({ replyTo: "wrong@acme.example" });
  const result = runEmailQaValidation(config, payload);
  assert.equal(result.ok, false);
  assert.ok(result.checks.replyTo.issues.some((i) => i.code === "REPLY_TO_MISMATCH"));
});

test("missing required link fails", async () => {
  await resetEnv();
  const config = baseConfig();
  const payload = basePayload({ renderedBody: "Hi Jane, welcome to Acme!" });
  const result = runEmailQaValidation(config, payload);
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.links.missing, ["https://acme.example/unsubscribe"]);
  assert.ok(result.checks.links.issues.some((i) => i.severity === "error"));
});

test("missing asset warns when criticality allows it, fails when it doesn't", async () => {
  await resetEnv();
  const warnConfig = baseConfig(); // missingAssetSeverity: "warning"
  const warnPayload = basePayload({ requiredAssets: ["https://acme.example/assets/logo.png"] });
  const warnResult = runEmailQaValidation(warnConfig, warnPayload);
  assert.equal(warnResult.verdict, "PASS_WITH_WARNINGS");
  assert.deepEqual(warnResult.checks.assets.missing, ["https://acme.example/assets/logo.png"]);

  const strictConfig = baseConfig({
    releaseBlockingRules: { ...warnConfig.releaseBlockingRules, missingAssetSeverity: "error" },
  });
  const strictResult = runEmailQaValidation(strictConfig, warnPayload);
  assert.equal(strictResult.verdict, "FAIL");
});

test("virtual inbox stores message", async () => {
  await resetEnv();
  const config = baseConfig();
  const payload = basePayload();
  const evidence = await runEmailQaAndProduceEvidence(config, payload);
  const messages = await listInboxMessages({ productId: "acme" });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageId, evidence.inboxMessageId);
  assert.equal(messages[0].subject, "Welcome to Acme");
  assert.equal(messages[0].emailType, "welcome");
  assert.ok(messages[0].createdAt);
});

test("evidence package is generated with dispatch via local fixture adapter", async () => {
  await resetEnv();
  const config = baseConfig();
  const payload = basePayload();
  const evidence = await runEmailQaAndProduceEvidence(config, payload, { adapter: new LocalFixtureAdapter(), dispatch: true });
  assert.ok(evidence.productConfigHash.startsWith("sha256:"));
  assert.ok(evidence.renderedPayloadHash.startsWith("sha256:"));
  assert.equal(evidence.deliveryCorrelation?.mode, "fixture");
  assert.equal(evidence.deliveryCorrelation?.simulated, true);
  assert.equal(evidence.verdict, "PASS");
});

test("Resend adapter does not call real provider by default", async () => {
  await resetEnv();
  let called = false;
  const stubClient = { sendEmail: async () => { called = true; return { id: "should-not-run" }; } } as unknown as ResendQaAdapterOptions["client"];

  // apiKey present, allowLiveSend NOT passed (default false), env flag unset.
  const defaultAdapter = new ResendQaAdapter({ apiKey: "re_test_key", client: stubClient });
  assert.equal(defaultAdapter.mode, "resend-test");
  const result1 = await defaultAdapter.send(basePayload());
  assert.equal(result1.simulated, true);
  assert.equal(called, false);

  // apiKey present, allowLiveSend true, but env flag still unset — must stay simulated.
  const halfEnabled = new ResendQaAdapter({ apiKey: "re_test_key", allowLiveSend: true, client: stubClient });
  assert.equal(liveResendSendExplicitlyEnabled(), false);
  const result2 = await halfEnabled.send(basePayload());
  assert.equal(result2.simulated, true);
  assert.equal(called, false);

  // Both gates set: env flag + allowLiveSend + apiKey — only now does it call the client.
  process.env.FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND = "explicit-live-send";
  const liveAdapter = new ResendQaAdapter({ apiKey: "re_test_key", allowLiveSend: true, client: stubClient });
  assert.equal(liveAdapter.mode, "resend-live");
  const result3 = await liveAdapter.send(basePayload());
  assert.equal(result3.simulated, false);
  assert.equal(called, true);
  assert.ok(result3.providerReference.startsWith("resend_live_"));
  delete process.env.FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND;
});

test("product config validates", async () => {
  const good = validateProductEmailConfig(baseConfig());
  assert.equal(good.ok, true);
  assert.equal(good.issues.length, 0);

  const bad = validateProductEmailConfig({ productId: "acme" }); // missing everything else
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.length > 0);
  assert.ok(bad.issues.every((i) => i.code === "CONFIG_SCHEMA_INVALID"));

  const dylnSample = validateProductEmailConfig(DYLN_SAMPLE_EMAIL_CONFIG);
  assert.equal(dylnSample.ok, true);
  assert.equal(dylnSample.config?.sample, true);
});
