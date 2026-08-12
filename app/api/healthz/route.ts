import { NextRequest, NextResponse } from "next/server";
import { persistenceHealth } from "@/lib/foundry/service";
import { authMode, checkSharedSecret } from "@/lib/foundry/auth";
import { mocksExplicitlyAllowed } from "@/lib/foundry/providers";

export const dynamic = "force-dynamic";

// Gated by FOUNDRY_SHARED_SECRET (X-Foundry-Auth header) rather than the
// Principal/session system — this is a liveness probe polled by sibling
// services that don't hold a Bearer token or cookie.
export async function GET(req: NextRequest) {
  const denied = checkSharedSecret(req);
  if (denied) return denied;
  const persistence = await persistenceHealth();
  return NextResponse.json({
    status: "ok",
    service: "foundry",
    version: "0.1.0",
    planner: process.env.ANTHROPIC_API_KEY ? "configured" : "missing_api_key",
    auth: authMode(),
    persistence: persistence.mode,
    production_safe_persistence: persistence.productionSafe,
    events: "durable-store",
    mock_providers:
      process.env.NODE_ENV !== "production" ? "dev" : mocksExplicitlyAllowed() ? "ALLOWED-EXPLICIT-TEST-MODE" : "production-locked",
  });
}
