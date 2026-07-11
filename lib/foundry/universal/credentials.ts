import type { ProviderManifest } from "./types";

/**
 * Provider Credential Registry.
 *
 * Execution and selection only ever see credential REFERENCES (env-var names
 * and `secret:` handles) — never plaintext. Plaintext custody stays inside
 * lib/security/kms.ts + lib/foundry/credentials.ts.
 */
export interface CredentialStatus {
  providerId: string;
  satisfied: boolean;
  /** Env-var names that are present. Names only, never values. */
  presentReferences: string[];
  /** Env-var names that are missing for live execution. */
  missingReferences: string[];
}

export function credentialStatusFor(manifest: ProviderManifest): CredentialStatus {
  const present: string[] = [];
  const missing: string[] = [];
  for (const reference of manifest.requiredCredentials) {
    if (process.env[reference]) present.push(reference);
    else missing.push(reference);
  }
  return {
    providerId: manifest.id,
    satisfied: missing.length === 0,
    presentReferences: present,
    missingReferences: missing,
  };
}

/**
 * Resolves the secret HANDLE an execution step should carry for a provider.
 * Returns a reference of the form `secret:<providerId>/<purpose>` — the
 * execution engine passes this through; only the adapter's HTTP client, fed
 * from the KMS-backed credential store or environment, ever holds plaintext.
 */
export function credentialReferenceFor(manifest: ProviderManifest, purpose = "execution"): string {
  return `secret:${manifest.id}/${purpose}`;
}

/** Guard: refuses any config object that appears to carry plaintext secrets. */
export function assertNoPlaintextSecrets(config: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") continue;
    const keyLooksSecret = /(token|secret|password|api[_-]?key)/i.test(key);
    if (keyLooksSecret && !value.startsWith("secret:")) {
      throw new Error(`config key "${key}" must be a secret reference (secret:...), never plaintext`);
    }
  }
}
