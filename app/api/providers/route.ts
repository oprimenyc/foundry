import { requireApiAuth } from "@/lib/foundry/auth";
import { NextResponse } from "next/server";
import { listRegisteredProviders } from "@/lib/foundry/providers";

export const dynamic = "force-dynamic";

// UI populates provider choices from this route instead of hardcoding them.
export async function GET(req: Request) {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  return NextResponse.json({
    repository: listRegisteredProviders("repository"),
    deployment: listRegisteredProviders("deployment"),
  });
}
