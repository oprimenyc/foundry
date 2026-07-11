import { NextResponse } from "next/server";
import { persistenceHealth } from "@/lib/foundry/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const persistence = await persistenceHealth();
  return NextResponse.json({
    status: "ok",
    service: "foundry",
    version: "0.1.0",
    planner: process.env.ANTHROPIC_API_KEY ? "configured" : "missing_api_key",
    persistence: persistence.mode,
    production_safe_persistence: persistence.productionSafe,
    log_bus: process.env.REDIS_URL ? "redis" : "memory",
  });
}
