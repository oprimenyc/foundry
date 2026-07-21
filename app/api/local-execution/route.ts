import { NextRequest, NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/foundry/auth";
import { recordLocalExecutionEvidence } from "@/lib/local-execution/evidence";
import { getLocalExecutionOperatorReport } from "@/lib/local-execution/operator";

/**
 * Operator surface for local-worker execution evidence (Phase 1).
 *  GET  ?productTarget=<id>  → operator report (aggregate, or scoped to one product/repo target).
 *  POST { ...raw evidence }  → ingest one local-worker evidence submission.
 *
 * Foundry never executes a local worker from this route — it only ingests,
 * evaluates, and preserves evidence of a run that already happened locally.
 */

export async function GET(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const productTarget = req.nextUrl.searchParams.get("productTarget") ?? undefined;
  const report = await getLocalExecutionOperatorReport({ productTarget });
  return NextResponse.json(report);
}

export async function POST(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }
  const { result, artifactId } = await recordLocalExecutionEvidence(body, { source: `api:${auth.principal.id}` });
  const status = result.status === "rejected" ? 400 : 201;
  return NextResponse.json({ ...result, artifactId }, { status });
}
