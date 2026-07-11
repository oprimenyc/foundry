import { requireApiAuth } from "@/lib/foundry/auth";
import { NextResponse } from "next/server";
import { listProviderMetadata, listRegisteredProviders } from "@/lib/foundry/providers";
import { universalRegistry } from "@/lib/foundry/universal/catalog";
import { credentialStatusFor } from "@/lib/foundry/universal/credentials";
import { healthScore } from "@/lib/foundry/universal/health";

export const dynamic = "force-dynamic";

// UI populates provider choices from this route instead of hardcoding them.
export async function GET(req: Request) {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  return NextResponse.json({
    // Back-compat id lists plus full capability metadata (providers, declared
    // actions, mock flag) so plans/UI never assume unsupported operations.
    repository: listRegisteredProviders("repository"),
    deployment: listRegisteredProviders("deployment"),
    capabilities: listProviderMetadata(),
    // Universal provider registry: manifests (credential NAMES only — never
    // values), capability matrix, and rolling health scores.
    manifests: universalRegistry.manifests().map((manifest) => ({
      ...manifest,
      credentialStatus: {
        satisfied: credentialStatusFor(manifest).satisfied,
        missing: credentialStatusFor(manifest).missingReferences,
      },
      healthScore: healthScore(manifest.id),
    })),
    capabilityMatrix: universalRegistry.capabilityMatrix(),
  });
}
