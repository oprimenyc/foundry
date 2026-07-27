import { NextRequest, NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/foundry/auth";
import { missionControlReport } from "@/lib/mission-runner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await missionControlReport(auth.principal.orgId));
}
