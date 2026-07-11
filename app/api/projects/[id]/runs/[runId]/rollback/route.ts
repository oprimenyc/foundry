import { resolvePrincipal } from "@/lib/foundry/auth";
import { authorizeRunAccess, ScopeError } from "@/lib/foundry/service";
import { NextResponse } from "next/server";
import { requestRollback } from "@/lib/foundry/execution";

export async function POST(req: Request, { params }: { params: { id: string; runId: string } }) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  try {
    await authorizeRunAccess(params.id, params.runId, auth.principal.orgId);
  } catch (error) {
    if (error instanceof ScopeError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
  await requestRollback(params.runId);
  return NextResponse.json({ ok: true }, { status: 202 });
}
