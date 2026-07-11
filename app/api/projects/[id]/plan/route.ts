import { resolvePrincipal } from "@/lib/foundry/auth";
import { ScopeError } from "@/lib/foundry/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPlanForProject } from "@/lib/foundry/service";

const BodySchema = z.object({
  prompt: z.string().min(10).max(2000),
  draftPlan: z.unknown().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan payload" }, { status: 400 });
  }

  try {
    const result = await createPlanForProject({
      projectId: params.id,
      orgId: auth.principal.orgId,
      prompt: parsed.data.prompt,
      draftPlan: parsed.data.draftPlan,
    });
    return NextResponse.json(result, { status: result.plan.status === "validated" ? 201 : 422 });
  } catch (error) {
    if (error instanceof ScopeError) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Plan creation failed" }, { status: 500 });
  }
}
