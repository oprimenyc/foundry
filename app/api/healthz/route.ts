import { NextResponse } from "next/server";
import { persistenceHealth } from "@/lib/foundry/service";
import { authMode } from "@/lib/foundry/auth";

export const dynamic = "force-dynamic";

// public: unauthenticated liveness/config probe; exposes no secrets or tenant data.
export async function GET() {
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
  });
}
