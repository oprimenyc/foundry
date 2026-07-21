import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePrincipal } from "@/lib/foundry/auth";
import { ingestSecretExposureFinding, SecretExposureFindingValidationError } from "@/lib/secret-remediation/evidence";
import { getRemediationOperatorReport, getRemediationStatus, decideRemediationGate } from "@/lib/secret-remediation/operator";
import { RemediationGateError } from "@/lib/secret-remediation/gates";
import {
  SECRET_CATEGORIES,
  EXPOSURE_LOCATIONS,
  SEVERITIES,
  CONTAINMENT_STATUSES,
  HISTORY_REWRITE_REQUIREMENTS,
} from "@/lib/secret-remediation/types";

/**
 * Operator surface for governed secret exposure remediation (Task 6).
 *  GET  ?findingId=<id>       → one finding's full remediation status.
 *  GET  (no findingId)        → aggregate operator report across all findings.
 *  POST { action: "finding.ingest", ... }  → ingest a new finding, produce plan + gates + advisories.
 *  POST { action: "gate.decide", gateId, decision, note? } → record a human approval decision.
 *
 * Foundry never rotates a credential or calls a provider API from this route
 * — ingestion only classifies, plans, and gates; deciding a gate only
 * records that a human authorized the *owner* to go act outside Foundry.
 */

const IngestFindingSchema = z.object({
  action: z.literal("finding.ingest"),
  project: z.string().min(1),
  filePath: z.string().min(1),
  sourceReference: z.string().min(1),
  secretCategory: z.enum(SECRET_CATEGORIES),
  exposureLocation: z.enum(EXPOSURE_LOCATIONS),
  secretFingerprint: z.string().optional(),
  severity: z.enum(SEVERITIES),
  containmentStatus: z.enum(CONTAINMENT_STATUSES),
  rotationRequired: z.boolean(),
  historyRewriteRequired: z.enum(HISTORY_REWRITE_REQUIREMENTS),
  deploymentEnvUpdateRequired: z.boolean(),
  notes: z.string().max(2000).optional(),
});

const DecideGateSchema = z.object({
  action: z.literal("gate.decide"),
  gateId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});

const BodySchema = z.union([IngestFindingSchema, DecideGateSchema]);

export async function GET(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const findingId = req.nextUrl.searchParams.get("findingId");
  const project = req.nextUrl.searchParams.get("project") ?? undefined;
  if (findingId) {
    const status = await getRemediationStatus(findingId);
    if (!status) return NextResponse.json({ error: `finding ${findingId} not found` }, { status: 404 });
    return NextResponse.json(status);
  }
  const report = await getRemediationOperatorReport({ project });
  return NextResponse.json(report);
}

export async function POST(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid secret remediation payload", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }

  if (parsed.data.action === "finding.ingest") {
    const { action, ...findingInput } = parsed.data;
    try {
      const { evidence } = await ingestSecretExposureFinding(findingInput);
      return NextResponse.json(evidence, { status: 201 });
    } catch (error) {
      if (error instanceof SecretExposureFindingValidationError) {
        return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
      }
      throw error;
    }
  }

  try {
    const gate = decideRemediationGate(parsed.data.gateId, parsed.data.decision, auth.principal.id, { note: parsed.data.note });
    return NextResponse.json({ ok: true, gate });
  } catch (error) {
    if (error instanceof RemediationGateError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
