import path from "path";

/** The ten fixtures Phase 4 ships (mission spec, Phase 4 "Fixture action plans"). No fixture contains a secret value. */
export const PROVIDER_ACTION_FIXTURE_FILES = [
  "panticandy-github-pat-revocation.fixture.json",
  "panticandy-db-credential-rotation.fixture.json",
  "vitalcore-nextauth-secret-regeneration.fixture.json",
  "vitalcore-google-oauth-rotation.fixture.json",
  "vitalcore-db-credential-rotation.fixture.json",
  "dyln-staging-env-update-advisory.fixture.json",
  "primeopp-domain-env-deployment-advisory.fixture.json",
  "railway-staging-env-update-dryrun.fixture.json",
  "fly-health-verification-dryrun.fixture.json",
  "vercel-missing-cli-blocked-advisory.fixture.json",
] as const;

export function providerActionFixturePath(fileName: (typeof PROVIDER_ACTION_FIXTURE_FILES)[number]): string {
  return path.join(__dirname, fileName);
}

export function allProviderActionFixturePaths(): string[] {
  return PROVIDER_ACTION_FIXTURE_FILES.map((f) => providerActionFixturePath(f));
}
