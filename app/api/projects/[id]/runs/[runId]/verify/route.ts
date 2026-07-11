import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/foundry/auth";
import { authorizeRunAccess, ScopeError } from "@/lib/foundry/service";
import { getVerificationView, verifyRunIndependently } from "@/lib/foundry/verification";

export const dynamic = "force-dynamic";

/** Triggers an independent verification attempt for a run's recorded resources. */
export async function POST(req: Request, { params }: { params: { id: string; runId: string } }) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  try {
    await authorizeRunAccess(params.id, params.runId, auth.principal.orgId);
  } catch (error) {
    if (error instanceof ScopeError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
  const records = await verifyRunIndependently(params.runId);
  const view = await getVerificationView(params.runId);
  return NextResponse.json({ attempted: records.length, ...view }, { status: 200 });
}

export async function GET(req: Request, { params }: { params: { id: string; runId: string } }) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  try {
    await authorizeRunAccess(params.id, params.runId, auth.principal.orgId);
  } catch (error) {
    if (error instanceof ScopeError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
  return NextResponse.json(await getVerificationView(params.runId));
}
