import { spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { sha256Canonical } from "@/lib/foundry/evidence-manifest";
import { runEmailQaAndProduceEvidence } from "../evidence";
import { LocalFixtureAdapter } from "../adapters/local-fixture.adapter";
import type { EmailQaOutboundAdapter } from "../adapters/types";
import type { EmailPayload, EmailQaEvidencePackage, RecipientType } from "../types";
import { DYLN_EMAIL_CONFIG } from "./dyln.config";

/**
 * Reads dyln's Tier A email QA fixtures read-only, from wherever the dyln
 * repo lives on this machine. Foundry never imports dyln source code — the
 * *.json fixture files are treated as the language-agnostic data contract
 * dyln's own handoff (`DYLN_FOUNDRY_EMAIL_QA_HANDOFF.md`) explicitly endorses
 * as option (b), so this module has zero dependency on dyln's Node/TS
 * toolchain, Firestore, or Stripe SDK. Shape validation below is an
 * independent re-implementation of dyln's own
 * `server/services/__fixtures__/email/index.ts` rules, not an import of it.
 *
 * Foundry does not write to any of these paths.
 */

export const DEFAULT_DYLN_REPO_PATH = "C:\\REPLIT PROJECTS\\dyln\\dyln";
export const DEFAULT_DYLN_FIXTURES_DIR = path.join(DEFAULT_DYLN_REPO_PATH, "server", "services", "__fixtures__", "email");

function dylnRepoPath(): string {
  return process.env.DYLN_REPO_PATH || DEFAULT_DYLN_REPO_PATH;
}

function dylnFixturesDir(): string {
  return process.env.DYLN_EMAIL_FIXTURES_DIR || DEFAULT_DYLN_FIXTURES_DIR;
}

/** Mirrors dyln's own `EmailFixture` type (server/services/__fixtures__/email/index.ts). */
export interface DylnEmailFixture {
  id: string;
  description: string;
  trigger: string;
  module: string;
  functionName: string;
  args: Record<string, unknown>;
  firestoreFixture?: Record<string, Record<string, unknown>>;
  recipientType: string;
  recipientPlaceholder: string;
  senderFrom: string;
  senderNote?: string;
  replyToExpected: string;
  replyToExplicit: boolean;
  requiredVariables: string[];
  requiredLinkPaths: string[];
  requiredAssets: string[];
  subjectContains: string[];
  legalFooter: { unsubscribe: boolean; copyright: boolean };
  criticality: string;
  notes?: string;
}

const REQUIRED_STRING_FIELDS: (keyof DylnEmailFixture)[] = [
  "id",
  "description",
  "trigger",
  "module",
  "functionName",
  "recipientType",
  "recipientPlaceholder",
  "senderFrom",
  "replyToExpected",
  "criticality",
];

/** Independent re-implementation of dyln's own fixture shape rules — no dyln code imported. */
export function validateDylnFixtureShape(fixture: Partial<DylnEmailFixture>, sourceLabel: string): asserts fixture is DylnEmailFixture {
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof fixture[field] !== "string" || (fixture[field] as string).length === 0) {
      throw new Error(`[dyln-loader] ${sourceLabel} is missing required string field "${field}"`);
    }
  }
  if (typeof fixture.args !== "object" || fixture.args === null) {
    throw new Error(`[dyln-loader] ${sourceLabel} is missing "args"`);
  }
  if (typeof fixture.replyToExplicit !== "boolean") {
    throw new Error(`[dyln-loader] ${sourceLabel} is missing boolean "replyToExplicit"`);
  }
  if (!Array.isArray(fixture.requiredVariables)) {
    throw new Error(`[dyln-loader] ${sourceLabel} is missing array "requiredVariables"`);
  }
  if (!Array.isArray(fixture.requiredLinkPaths)) {
    throw new Error(`[dyln-loader] ${sourceLabel} is missing array "requiredLinkPaths"`);
  }
  if (!Array.isArray(fixture.requiredAssets)) {
    throw new Error(`[dyln-loader] ${sourceLabel} is missing array "requiredAssets"`);
  }
  if (!Array.isArray(fixture.subjectContains) || fixture.subjectContains.length === 0) {
    throw new Error(`[dyln-loader] ${sourceLabel} must have a non-empty "subjectContains" array`);
  }
  if (
    typeof fixture.legalFooter !== "object" ||
    fixture.legalFooter === null ||
    typeof fixture.legalFooter.unsubscribe !== "boolean" ||
    typeof fixture.legalFooter.copyright !== "boolean"
  ) {
    throw new Error(`[dyln-loader] ${sourceLabel} has an invalid "legalFooter" object`);
  }
  // No real customer data / no secrets guardrail, mirroring dyln's own rule.
  // Already confirmed a non-empty string by the REQUIRED_STRING_FIELDS loop above.
  const recipientPlaceholder = fixture.recipientPlaceholder as string;
  if (!/@dyln\.test$/i.test(recipientPlaceholder) && !/^ADMIN_EMAIL/i.test(recipientPlaceholder)) {
    throw new Error(
      `[dyln-loader] ${sourceLabel} recipientPlaceholder "${recipientPlaceholder}" must use the @dyln.test placeholder domain or reference ADMIN_EMAIL`
    );
  }
}

/**
 * Loads every dyln Tier A email fixture from `dir` (default: dyln's real
 * fixtures directory on this machine, overridable via
 * `DYLN_EMAIL_FIXTURES_DIR`). Throws — never silently returns empty — when
 * the directory is missing or contains no fixture files (Constitution §1: no
 * silent failures).
 */
export function loadDylnEmailFixtures(dir: string = dylnFixturesDir()): DylnEmailFixture[] {
  if (!existsSync(dir)) {
    throw new Error(`[dyln-loader] fixtures directory not found: ${dir}`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(`[dyln-loader] no *.json fixture files found in ${dir}`);
  }
  return files.map((file) => {
    const filePath = path.join(dir, file);
    const raw = readFileSync(filePath, "utf8");
    let parsed: Partial<DylnEmailFixture>;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`[dyln-loader] ${file} is not valid JSON: ${(error as Error).message}`);
    }
    validateDylnFixtureShape(parsed, file);
    return parsed;
  });
}

/** Flattens one level of nested objects in a fixture's `args` (e.g. `args.contactRequest.*`). */
function flattenArgs(args: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(flat, value as Record<string, unknown>);
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

/**
 * dyln's requiredLinkPaths mix host-agnostic path suffixes (`/dashboard`,
 * since `APP_URL` varies by environment) with already-absolute links
 * (`mailto:...`, `tel:...`, `https://getdyln.com/support`). Foundry's link
 * check is a raw substring match, so the synthetic host attached to a bare
 * path suffix below is immaterial to correctness — only the suffix itself,
 * which is what the fixture actually asserts, has to appear in the body.
 */
function linkPathToUrl(linkPath: string): string {
  if (/^(https?:|mailto:|tel:)/i.test(linkPath)) return linkPath;
  return `https://app.getdyln.com${linkPath}`;
}

const DYLN_UNSUBSCRIBE_LINK = "https://getdyln.com/unsubscribe";
const ADMIN_TEST_ADDRESS = "qa+admin@dyln.test";

/**
 * Synthesizes a self-consistent Foundry `EmailPayload` from one dyln
 * fixture's declared contract. This does NOT execute dyln's real render
 * pipeline (Foundry has no dependency on dyln's source) — template-variable
 * values not literally present in the fixture's `args` are filled with a
 * clearly-synthetic `qa-synth-<var>` placeholder, never a reproduction of
 * dyln's actual interpolation logic. See FOUNDRY_DYLN_EMAIL_QA_CURRENT_TRUTH.md
 * "Scope boundary" for what a resulting PASS does and does not prove.
 */
export function mapDylnFixtureToPayload(fixture: DylnEmailFixture): EmailPayload {
  const argValues = flattenArgs(fixture.args);

  const templateInputs: Record<string, string> = {};
  for (const key of fixture.requiredVariables) {
    const value = argValues[key];
    templateInputs[key] = value !== undefined && value !== null ? String(value) : `qa-synth-${key}`;
  }

  const recipientAddress = /^ADMIN_EMAIL/i.test(fixture.recipientPlaceholder) ? ADMIN_TEST_ADDRESS : fixture.recipientPlaceholder;
  const recipientType: RecipientType = fixture.recipientType === "internal_admin" ? "admin" : "customer";

  const linkUrls = fixture.requiredLinkPaths.map(linkPathToUrl);
  const requiredLinks = fixture.legalFooter.unsubscribe ? [...linkUrls, DYLN_UNSUBSCRIBE_LINK] : linkUrls;

  const bodyLines = [
    `[Foundry QA payload synthesized from dyln fixture "${fixture.id}" — not dyln's live-rendered output]`,
    ...Object.entries(templateInputs).map(([key, value]) => `${key}: ${value}`),
    ...linkUrls,
  ];
  if (fixture.legalFooter.unsubscribe) bodyLines.push(DYLN_UNSUBSCRIBE_LINK);
  if (fixture.legalFooter.copyright) bodyLines.push("© DYLN");

  return {
    productId: "dyln",
    emailType: fixture.id,
    recipient: { type: recipientType, address: recipientAddress },
    from: fixture.senderFrom,
    replyTo: fixture.replyToExplicit ? fixture.replyToExpected : undefined,
    subject: fixture.subjectContains.join(" "),
    templateInputs,
    renderedBody: bodyLines.join("\n"),
    requiredLinks,
    requiredAssets: fixture.requiredAssets,
    headers: { "X-Foundry-Source": "dyln-fixture", "X-Dyln-Fixture-Id": fixture.id },
  };
}

export interface DylnRepoState {
  repoPath: string;
  head: string;
  branch: string;
}

/** Read-only `git -C <dylnRepoPath>` handshake — never mutates the dyln repo. */
export function getDylnRepoState(repoPath: string = dylnRepoPath()): DylnRepoState {
  const head = spawnSync("git", ["-C", repoPath, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0 || !head.stdout.trim()) {
    throw new Error(`[dyln-loader] could not read dyln repo HEAD at ${repoPath}: ${head.stderr || head.error?.message || "unknown error"}`);
  }
  const branch = spawnSync("git", ["-C", repoPath, "branch", "--show-current"], { encoding: "utf8" });
  if (branch.status !== 0) {
    throw new Error(`[dyln-loader] could not read dyln repo branch at ${repoPath}: ${branch.stderr || branch.error?.message || "unknown error"}`);
  }
  return { repoPath, head: head.stdout.trim(), branch: branch.stdout.trim() };
}

export interface DylnFixtureEvidenceRef {
  fixtureId: string;
  functionName: string;
  module: string;
  fixtureHash: string;
  verdict: EmailQaEvidencePackage["verdict"];
  evidenceId: string;
  inboxMessageId: string;
  renderedPayloadHash: string;
  providerCallMade: boolean;
}

export interface DylnIntegrationEvidence {
  dylnRepoPath: string;
  dylnRepoHead: string;
  dylnRepoBranch: string;
  fixturesDir: string;
  generatedAt: string;
  fixtures: DylnFixtureEvidenceRef[];
}

export interface RunDylnEmailQaIntegrationOptions {
  fixturesDir?: string;
  repoPath?: string;
  adapter?: EmailQaOutboundAdapter;
}

/**
 * Loads every dyln Tier A fixture, maps each to a Foundry EmailPayload, runs
 * the full QA + evidence + virtual-inbox pipeline via the LocalFixtureAdapter
 * (no network, no cost, no real provider call), and returns an integration
 * evidence bundle carrying dyln's repo path/HEAD alongside per-fixture
 * hashes and verdicts — the artifact Foundry emits "for dyln".
 */
export async function runDylnEmailQaIntegration(options: RunDylnEmailQaIntegrationOptions = {}): Promise<DylnIntegrationEvidence> {
  const fixturesDir = options.fixturesDir ?? dylnFixturesDir();
  const repo = getDylnRepoState(options.repoPath);
  const fixtures = loadDylnEmailFixtures(fixturesDir);
  const adapter = options.adapter ?? new LocalFixtureAdapter();

  const refs: DylnFixtureEvidenceRef[] = [];
  for (const fixture of fixtures) {
    const payload = mapDylnFixtureToPayload(fixture);
    const evidence = await runEmailQaAndProduceEvidence(DYLN_EMAIL_CONFIG, payload, { adapter, dispatch: true });
    refs.push({
      fixtureId: fixture.id,
      functionName: fixture.functionName,
      module: fixture.module,
      fixtureHash: sha256Canonical(fixture),
      verdict: evidence.verdict,
      evidenceId: evidence.evidenceId,
      inboxMessageId: evidence.inboxMessageId,
      renderedPayloadHash: evidence.renderedPayloadHash,
      providerCallMade: evidence.deliveryCorrelation ? !evidence.deliveryCorrelation.simulated : false,
    });
  }

  return {
    dylnRepoPath: repo.repoPath,
    dylnRepoHead: repo.head,
    dylnRepoBranch: repo.branch,
    fixturesDir,
    generatedAt: new Date().toISOString(),
    fixtures: refs,
  };
}
