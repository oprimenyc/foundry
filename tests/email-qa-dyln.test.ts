import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { resetFoundryPersistence } from "@/lib/foundry/store";
import { runEmailQaValidation } from "@/lib/email-qa/validate";
import { runEmailQaAndProduceEvidence } from "@/lib/email-qa/evidence";
import { listInboxMessages } from "@/lib/email-qa/inbox";
import { LocalFixtureAdapter } from "@/lib/email-qa/adapters/local-fixture.adapter";
import { DYLN_EMAIL_CONFIG } from "@/lib/email-qa/fixtures/dyln.config";
import {
  loadDylnEmailFixtures,
  mapDylnFixtureToPayload,
  runDylnEmailQaIntegration,
  DEFAULT_DYLN_FIXTURES_DIR,
  type DylnEmailFixture,
} from "@/lib/email-qa/fixtures/dyln-loader";

const testDir = path.join(process.cwd(), ".foundry-test-data", "email-qa-dyln");

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

function validFixtureJson(overrides: Partial<DylnEmailFixture> = {}): DylnEmailFixture {
  return {
    id: "welcome",
    description: "Welcome email",
    trigger: "New account created",
    module: "server/services/emailService.ts",
    functionName: "sendWelcomeEmail",
    args: { email: "qa+welcome@dyln.test", displayName: "Jordan Rivera" },
    recipientType: "new_user",
    recipientPlaceholder: "qa+welcome@dyln.test",
    senderFrom: "support@getdyln.com",
    replyToExpected: "support@getdyln.com",
    replyToExplicit: false,
    requiredVariables: ["firstName"],
    requiredLinkPaths: ["/dashboard"],
    requiredAssets: [],
    subjectContains: ["Welcome to DYLN"],
    legalFooter: { unsubscribe: true, copyright: true },
    criticality: "release-critical",
    ...overrides,
  };
}

test("valid dyln fixture maps to a payload that passes Foundry QA", async () => {
  await resetEnv();
  const fixture = validFixtureJson();
  const payload = mapDylnFixtureToPayload(fixture);
  const evidence = await runEmailQaAndProduceEvidence(DYLN_EMAIL_CONFIG, payload, { adapter: new LocalFixtureAdapter(), dispatch: true });
  assert.ok(["PASS", "PASS_WITH_WARNINGS"].includes(evidence.verdict), `expected PASS-family verdict, got ${evidence.verdict}`);
  assert.ok(evidence.evidenceId);
  assert.ok(evidence.inboxMessageId);
});

test("missing fixture directory throws a clear error, never returns silently empty", async () => {
  await resetEnv();
  const missingDir = path.join(tmpdir(), `dyln-fixtures-missing-${randomUUID()}`);
  assert.throws(() => loadDylnEmailFixtures(missingDir), /fixtures directory not found/);
});

test("malformed fixture (invalid JSON and missing required field) is rejected, not silently accepted", async () => {
  await resetEnv();
  const dir = path.join(testDir, "malformed-fixtures");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "broken.json"), "{ not valid json", "utf8");
  assert.throws(() => loadDylnEmailFixtures(dir), /not valid JSON/);

  const dir2 = path.join(testDir, "malformed-fixtures-2");
  await mkdir(dir2, { recursive: true });
  const missingField = validFixtureJson() as Partial<DylnEmailFixture>;
  delete missingField.senderFrom;
  await writeFile(path.join(dir2, "missing-field.json"), JSON.stringify(missingField), "utf8");
  assert.throws(() => loadDylnEmailFixtures(dir2), /missing required string field "senderFrom"/);
});

test("payload claiming the wrong product identity fails against the dyln config", async () => {
  await resetEnv();
  const payload = mapDylnFixtureToPayload(validFixtureJson());
  const wrongProductPayload = { ...payload, productId: "some-other-product" };
  const result = runEmailQaValidation(DYLN_EMAIL_CONFIG, wrongProductPayload);
  assert.equal(result.ok, false);
  assert.ok(result.checks.productIdentity.issues.some((i) => i.code === "PRODUCT_IDENTITY_MISMATCH"));
});

test("unresolved placeholder against the confirmed dyln config is BLOCKED (welcome is release-blocking)", async () => {
  await resetEnv();
  const payload = mapDylnFixtureToPayload(validFixtureJson());
  payload.renderedBody = "Hi {{firstName}}, welcome! https://getdyln.com/unsubscribe";
  const result = runEmailQaValidation(DYLN_EMAIL_CONFIG, payload);
  assert.equal(result.ok, false);
  assert.equal(result.verdict, "BLOCKED");
  assert.deepEqual(result.checks.placeholders.unresolved, ["{{firstName}}"]);
});

test("dyln's known sender-mismatch gap (follow-up-email uses noreply@, not support@) surfaces as an explained FAIL, not a silent pass", async () => {
  await resetEnv();
  const fixture = validFixtureJson({
    id: "follow-up-email",
    senderFrom: "noreply@getdyln.com",
    recipientPlaceholder: "qa+followup@dyln.test",
    requiredVariables: ["fromName"],
    requiredLinkPaths: [],
    legalFooter: { unsubscribe: false, copyright: false },
    subjectContains: ["Following up on your DYLN quote"],
    criticality: "high",
  });
  const payload = mapDylnFixtureToPayload(fixture);
  const result = runEmailQaValidation(DYLN_EMAIL_CONFIG, payload);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.checks.sender.issues.some((i) => i.code === "SENDER_MISMATCH"));
});

test("full dyln integration: 17 real fixtures, no provider call, inbox capture, evidence refs all present", async () => {
  await resetEnv();
  const bundle = await runDylnEmailQaIntegration({ fixturesDir: DEFAULT_DYLN_FIXTURES_DIR });

  assert.equal(bundle.fixtures.length, 17);
  assert.ok(bundle.dylnRepoPath);
  assert.ok(bundle.dylnRepoHead);
  assert.match(bundle.dylnRepoHead, /^[0-9a-f]{40}$/);

  // No provider call — every single fixture, not just a sample.
  assert.ok(bundle.fixtures.every((f) => f.providerCallMade === false));

  // Evidence refs present for every fixture.
  for (const f of bundle.fixtures) {
    assert.ok(f.evidenceId, `${f.fixtureId} missing evidenceId`);
    assert.ok(f.inboxMessageId, `${f.fixtureId} missing inboxMessageId`);
    assert.ok(f.fixtureHash.startsWith("sha256:"), `${f.fixtureId} fixtureHash malformed`);
    assert.ok(f.renderedPayloadHash.startsWith("sha256:"), `${f.fixtureId} renderedPayloadHash malformed`);
  }

  // Only the known, documented sender-mismatch gap fails; nothing else FAILs or is BLOCKED.
  const failed = bundle.fixtures.filter((f) => f.verdict === "FAIL").map((f) => f.fixtureId);
  const blocked = bundle.fixtures.filter((f) => f.verdict === "BLOCKED");
  assert.deepEqual(failed, ["follow-up-email"]);
  assert.deepEqual(blocked, []);

  // Virtual inbox actually captured all 17 messages.
  const inbox = await listInboxMessages({ productId: "dyln" });
  assert.equal(inbox.length, 17);
  assert.ok(inbox.every((m) => m.productId === "dyln"));
});

test("loader parses all 17 real dyln fixture files without throwing", async () => {
  await resetEnv();
  const fixtures = loadDylnEmailFixtures(DEFAULT_DYLN_FIXTURES_DIR);
  assert.equal(fixtures.length, 17);
  const ids = fixtures.map((f) => f.id).sort();
  assert.ok(ids.includes("welcome"));
  assert.ok(ids.includes("follow-up-email"));
  assert.equal(new Set(ids).size, ids.length, "fixture ids must be unique");
});

test("integration evidence carries product config hash, per-check breakdowns, production-recipient confirmation, and a worst-of final verdict", async () => {
  await resetEnv();
  const bundle = await runDylnEmailQaIntegration({ fixturesDir: DEFAULT_DYLN_FIXTURES_DIR });

  assert.ok(bundle.productConfigHash.startsWith("sha256:"));
  // Every dyln fixture recipient is a @dyln.test placeholder — never a production address.
  assert.ok(bundle.fixtures.every((f) => f.productionRecipient === false));

  for (const f of bundle.fixtures) {
    assert.ok(f.productConfigHash.startsWith("sha256:"), `${f.fixtureId} missing productConfigHash`);
    assert.equal(typeof f.senderValidation.ok, "boolean", `${f.fixtureId} missing senderValidation`);
    assert.equal(typeof f.replyToValidation.ok, "boolean", `${f.fixtureId} missing replyToValidation`);
    assert.ok(Array.isArray(f.placeholderCheck.unresolved), `${f.fixtureId} missing placeholderCheck`);
    assert.ok(Array.isArray(f.linkCheck.missing), `${f.fixtureId} missing linkCheck`);
    assert.ok(Array.isArray(f.assetCheck.missing), `${f.fixtureId} missing assetCheck`);
  }

  // The known follow-up-email sender-mismatch FAIL caps the whole integration's final verdict at FAIL.
  const followUp = bundle.fixtures.find((f) => f.fixtureId === "follow-up-email");
  assert.equal(followUp?.verdict, "FAIL");
  assert.equal(followUp?.senderValidation.ok, false);
  assert.equal(bundle.finalVerdict, "FAIL");
});
