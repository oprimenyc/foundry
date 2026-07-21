/**
 * Raw-secret rejection for the secret remediation orchestrator.
 *
 * Distinct from lib/vault/redaction.ts (which redacts values already known to
 * be secret, e.g. before persisting an artifact). This module exists so a raw
 * secret can never be *accepted* as input in the first place — a finding
 * carrying a matched pattern is rejected outright, not merely masked.
 */

const RAW_SECRET_PATTERNS: RegExp[] = [
  // GitHub PAT shapes (classic + fine-grained + oauth/user/refresh tokens).
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  // Stripe-shaped keys (not a target category here, but a raw secret is a raw secret).
  /\bsk_(live|test)_[A-Za-z0-9]{8,}\b/,
  // AWS access key id shape.
  /\bAKIA[0-9A-Z]{16}\b/,
  // Slack token shape.
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  // Bearer / Basic auth headers.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/,
  // Connection strings / URLs with embedded credentials: scheme://user:pass@host
  /\w+:\/\/[^/\s:@]+:[^/\s:@]+@/,
  // Generic KEY=<long value> assignment, the shape a raw .env line takes. Deliberately NOT a
  // bare-hex/base64-blob pattern — that would false-positive on ordinary git commit SHAs
  // (40 hex chars), which this module legitimately stores in sourceReference fields.
  /\b[A-Z][A-Z0-9_]{2,}\s*=\s*['"]?[A-Za-z0-9+/_.-]{16,}['"]?/,
];

export interface SecretScanMatch {
  field: string;
  patternDescription: string;
}

/** Scans every string leaf of `value` for raw-secret-shaped material. Never returns the matched text itself. */
export function scanForRawSecretMaterial(value: unknown, pathPrefix = ""): SecretScanMatch[] {
  const matches: SecretScanMatch[] = [];
  walk(value, pathPrefix, matches);
  return matches;
}

function walk(value: unknown, fieldPath: string, matches: SecretScanMatch[]): void {
  if (typeof value === "string") {
    for (const pattern of RAW_SECRET_PATTERNS) {
      if (pattern.test(value)) {
        matches.push({ field: fieldPath || "(root)", patternDescription: pattern.source });
        break; // one flag per field is enough to reject
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${fieldPath}[${index}]`, matches));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      walk(item, fieldPath ? `${fieldPath}.${key}` : key, matches);
    }
  }
}

export class RawSecretRejectedError extends Error {
  readonly matches: SecretScanMatch[];
  constructor(matches: SecretScanMatch[]) {
    super(
      `raw secret-shaped material detected and rejected in field(s): ${matches.map((m) => m.field).join(", ")} — Foundry never accepts, stores, or prints secret values, only categories and fingerprints`
    );
    this.name = "RawSecretRejectedError";
    this.matches = matches;
  }
}

/** Throws RawSecretRejectedError if any string leaf of `value` looks like a raw secret. */
export function assertNoRawSecretMaterial(value: unknown): void {
  const matches = scanForRawSecretMaterial(value);
  if (matches.length > 0) throw new RawSecretRejectedError(matches);
}

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** A secret "fingerprint" is only ever an opaque sha256 hash — never the value it was derived from. */
export function isValidSecretFingerprint(value: string): boolean {
  return FINGERPRINT_PATTERN.test(value);
}
