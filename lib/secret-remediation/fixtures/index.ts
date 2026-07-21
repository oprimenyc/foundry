import { ingestSecretExposureFinding } from "../evidence";
import type { SecretRemediationEvidencePackage } from "../types";
import { loadPanticandyFixtures } from "./panticandy.fixtures";
import { loadVitalcoreFixtures } from "./vitalcore.fixtures";

export { loadPanticandyFixtures } from "./panticandy.fixtures";
export { loadVitalcoreFixtures } from "./vitalcore.fixtures";

export function loadAllFixtures() {
  return [...loadPanticandyFixtures(), ...loadVitalcoreFixtures()];
}

/** Ingests every fixture case through the full pipeline. Used by tests and the proof script. */
export async function ingestAllFixtures(): Promise<SecretRemediationEvidencePackage[]> {
  const results: SecretRemediationEvidencePackage[] = [];
  for (const fixture of loadAllFixtures()) {
    const { evidence } = await ingestSecretExposureFinding(fixture);
    results.push(evidence);
  }
  return results;
}
