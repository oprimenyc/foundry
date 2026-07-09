import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "foundry",
    version: "0.1.0",
    planner: process.env.ANTHROPIC_API_KEY ? "configured" : "missing_api_key",
    persistence: process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "none",
    log_bus: process.env.REDIS_URL ? "redis" : "memory",
  });
}
