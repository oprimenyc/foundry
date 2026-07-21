import { NextRequest, NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/foundry/auth";
import { ingestProviderActionRequest, ProviderActionRequestValidationError, UnsupportedProviderActionError } from "@/lib/provider-actions/evidence";
import { getProviderActionOperatorReport, getProviderActionStatus } from "@/lib/provider-actions/operator";

/**
 * Operator surface for approval-gated provider action plans (Phase 5).
 *  GET  ?actionId=<id>      -> single action status.
 *  GET  ?project=<id>       -> operator report (aggregate, or scoped to one project).
 *  POST { ...action input } -> prepare one dry-run provider action plan.
 *
 * This route never calls a live provider. It only ever prepares, evaluates,
 * and evidences a plan for a human to review and (outside Foundry) execute.
 */

export async function GET(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const actionId = req.nextUrl.searchParams.get("actionId");
  if (actionId) {
    const status = await getProviderActionStatus(actionId);
    if (!status) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(status);
  }
  const project = req.nextUrl.searchParams.get("project") ?? undefined;
  const report = await getProviderActionOperatorReport({ project });
  return NextResponse.json(report);
}

export async function POST(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "request body must be valid JSON" }, { status: 400 });
  }
  try {
    const { evidence } = await ingestProviderActionRequest(body);
    return NextResponse.json(evidence, { status: 201 });
  } catch (error) {
    if (error instanceof ProviderActionRequestValidationError) {
      return NextResponse.json({ error: "malformed_request", issues: error.issues }, { status: 400 });
    }
    if (error instanceof UnsupportedProviderActionError) {
      return NextResponse.json({ error: "unsupported_provider_action", message: error.message }, { status: 400 });
    }
    throw error;
  }
}
