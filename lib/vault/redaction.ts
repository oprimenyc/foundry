/**
 * Central secret redaction. Sanitizes structured logs, errors, evidence,
 * provider responses, audit metadata, headers, and URLs before anything
 * crosses a trust boundary (persistence, API response, event stream, E.V.E.).
 *
 * Three layers, because field names alone are insufficient:
 *  1. Key-based: known-sensitive field names are always masked.
 *  2. Value-based taint: every plaintext the trusted resolver hands out is
 *     registered here and scrubbed wherever it appears, under any key.
 *  3. Pattern-based: bearer headers, basic-auth URLs, common key formats.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|set-cookie|api[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key|client[_-]?secret|credential|session[_-]?id|signature)/i;

const VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/g,
  // URLs with embedded credentials: scheme://user:pass@host
  /(\w+:\/\/)([^\/\s:@]+):([^\/\s:@]+)@/g,
  // Common provider key shapes (Stripe, GitHub, AWS, Slack, generic 32+ hex).
  /\bsk_(live|test)_[A-Za-z0-9]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
];

// Runtime taint registry: known secret plaintexts, scrubbed on sight.
const globalTaint = globalThis as unknown as { __primeVaultTaint?: Set<string> };
if (!globalTaint.__primeVaultTaint) globalTaint.__primeVaultTaint = new Set();
const taint = globalTaint.__primeVaultTaint;

/** Called by the trusted resolver for every plaintext it releases. */
export function registerSecretValue(value: string): void {
  if (value && value.length >= 4) taint.add(value);
}

/** Test hook. Values stay registered for the process lifetime otherwise. */
export function clearTaintRegistry(): void {
  taint.clear();
}

export function redactString(input: string): string {
  let out = input;
  for (const secret of Array.from(taint)) {
    while (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  for (const pattern of VALUE_PATTERNS) {
    out = out.replace(pattern, (match, ...groups) =>
      // URL-credential pattern keeps the scheme, masks user:pass.
      typeof groups[0] === "string" && String(match).includes("@") && String(groups[0]).endsWith("://")
        ? `${groups[0]}${REDACTED}@`
        : REDACTED
    );
  }
  return out;
}

function redactKeyed(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  return redactValue(value);
}

/** Deeply redacts any value: objects, arrays, nested maps, strings. */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as unknown as T;
  if (value instanceof Error) return redactError(value) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactKeyed(key, item);
    }
    return out as unknown as T;
  }
  return value;
}

export function redactObject<T extends Record<string, unknown>>(obj: T): T {
  return redactValue(obj);
}

/** Safe error shape: message and name only, both scrubbed; no bodies, no stacks. */
export function redactError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: redactString(error.message) };
  }
  return { name: "Error", message: redactString(String(error)) };
}

/** Strips credentials from URLs and query strings. */
export function redactUrl(url: string): string {
  let out = redactString(url);
  out = out.replace(/([?&](?:token|key|api_key|apikey|secret|password|access_token|sig|signature)=)[^&#\s]+/gi, `$1${REDACTED}`);
  return out;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactString(value);
  }
  return out;
}

/** True if the (already-serialized) payload still contains tainted material. */
export function containsSecretMaterial(payload: string): boolean {
  for (const secret of Array.from(taint)) {
    if (payload.includes(secret)) return true;
  }
  return false;
}
