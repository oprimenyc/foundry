import { resolvePrincipal } from "@/lib/foundry/auth";
import { authorizeRunAccess, ScopeError } from "@/lib/foundry/service";
import { NextResponse } from "next/server";
import { decideGate, listGates, GateError } from "@/lib/foundry/human-gates";
import { resumeRunAfterGate } from "@/lib/foundry/execution";

/**
 * Operator surface for human gates on a paused run.
 *  GET  → list gates (approvals) for the run.
 *  POST → decide a gate { gateId, decision: approved|rejected|deferred, note? }
 *         and, on approval, resume the run from the exact paused step.
 */
export async function GET(req: Request, { params }: { params: { id: string; runId: string } }) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  try {
    await authorizeRunAccess(params.id, params.runId, auth.principal.orgId);
  } catch (error) {
    if (error instanceof ScopeError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
  const gates = await listGates({ runId: params.runId });
  return NextResponse.json({ gates }, { status: 200 });
}

export async function POST(req: Request, { params }: { params: { id: string; runId: string } }) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  try {
    await authorizeRunAccess(params.id, params.runId, auth.principal.orgId);
  } catch (error) {
    if (error instanceof ScopeError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }

  let body: { gateId?: string; decision?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { gateId, decision, note } = body;
  if (!gateId || (decision !== "approved" && decision !== "rejected" && decision !== "deferred")) {
    return NextResponse.json({ error: "gateId and decision (approved|rejected|deferred) are required" }, { status: 400 });
  }

  try {
    const gate = await decideGate(gateId, decision, auth.principal.orgId, { note });
    if (gate.runId !== params.runId) {
      return NextResponse.json({ error: "gate does not belong to this run" }, { status: 404 });
    }
    // Approval or rejection both resume execution; the engine then proceeds or
    // fails the run at the exact paused step.
    await resumeRunAfterGate(params.runId);
    return NextResponse.json({ ok: true, gate }, { status: 202 });
  } catch (error) {
    if (error instanceof GateError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
