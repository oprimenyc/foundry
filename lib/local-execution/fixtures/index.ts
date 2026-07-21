import path from "path";

/**
 * The six fixtures Phase 1 ships (mission spec, Phase 1 "Fixtures"):
 * two tools blocked pending install/environment issues, one slow-but-real
 * CPU-only local model run, one clean governance-tier proof, one blocked
 * provider-mutation attempt, and one blocked secret-exposure attempt.
 */
export const LOCAL_EXECUTION_FIXTURE_FILES = [
  "jcode-blocked.fixture.json",
  "wigolo-blocked.fixture.json",
  "ollama-cpu-slow.fixture.json",
  "primeos-tier-proof.fixture.json",
  "blocked-provider-mutation.fixture.json",
  "blocked-secret-exposure.fixture.json",
] as const;

export function localExecutionFixturePath(fileName: (typeof LOCAL_EXECUTION_FIXTURE_FILES)[number]): string {
  return path.join(__dirname, fileName);
}

export function allLocalExecutionFixturePaths(): string[] {
  return LOCAL_EXECUTION_FIXTURE_FILES.map((f) => localExecutionFixturePath(f));
}
