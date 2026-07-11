import { resolvePrincipal } from "@/lib/foundry/auth";
import { NextResponse } from "next/server";
import { getRunView } from "@/lib/foundry/service";

export async function GET(req: Request, { params }: { params: { id: string; runId: string } }) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const view = await getRunView(params.id, params.runId, auth.principal.orgId);
  if (!view) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(view);
}
