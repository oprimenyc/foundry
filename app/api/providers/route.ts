import { NextResponse } from "next/server";
import { listRegisteredProviders } from "@/lib/foundry/providers";

export const dynamic = "force-dynamic";

// UI populates provider choices from this route instead of hardcoding them.
export async function GET() {
  return NextResponse.json({
    repository: listRegisteredProviders("repository"),
    deployment: listRegisteredProviders("deployment"),
  });
}
