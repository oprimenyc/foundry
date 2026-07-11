import { resolvePrincipal } from "@/lib/foundry/auth";
import { ScopeError } from "@/lib/foundry/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRunForProject } from "@/lib/foundry/service";

const BodySchema = z.object({
  planId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid run payload" }, { status: 400 });
  }

  try {
    const run = await createRunForProject({
      projectId: params.id,
      orgId: auth.principal.orgId,
      requestedBy: auth.principal.id,
      planId: parsed.data.planId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(run, { status: 202 });
  } catch (error) {
    if (error instanceof ScopeError) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Run creation failed" }, { status: 422 });
  }
}
