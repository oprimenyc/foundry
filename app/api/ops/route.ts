import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePrincipal } from "@/lib/foundry/auth";
import { getOperationsReport, openManualOperationalIncident, resolveOperationalIncidentRecord } from "@/lib/foundry/ops";

export const dynamic = "force-dynamic";

const OpenIncidentSchema = z.object({
  action: z.literal("incident.open"),
  scope: z.enum(["provider", "credential", "deployment", "service", "environment", "dependency"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  summary: z.string().min(5).max(240),
  providerId: z.string().optional(),
  credentialReferenceId: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  impact: z.string().min(5).max(500),
  recommendedActions: z.array(z.string()).min(1),
  rollbackPlan: z.array(z.string()).min(1),
  evidence: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
});

const ResolveIncidentSchema = z.object({
  action: z.literal("incident.resolve"),
  incidentId: z.string().min(1),
  resolutionEvidence: z.string().min(5).max(500),
});

const BodySchema = z.union([OpenIncidentSchema, ResolveIncidentSchema]);

export async function GET(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const report = await getOperationsReport(auth.principal.orgId, auth.principal.id);
  return NextResponse.json(report);
}

export async function POST(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid operations payload" }, { status: 400 });
  }
  if (parsed.data.action === "incident.open") {
    const incident = await openManualOperationalIncident({
      actor: auth.principal.id,
      ...parsed.data,
    });
    return NextResponse.json(incident, { status: 201 });
  }
  await resolveOperationalIncidentRecord(parsed.data.incidentId, auth.principal.id, parsed.data.resolutionEvidence);
  return NextResponse.json({ ok: true });
}
