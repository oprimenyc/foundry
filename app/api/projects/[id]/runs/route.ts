import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRunForProject } from "@/lib/foundry/service";

const BodySchema = z.object({
  planId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid run payload" }, { status: 400 });
  }

  try {
    const run = await createRunForProject({
      projectId: params.id,
      planId: parsed.data.planId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(run, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Run creation failed" }, { status: 422 });
  }
}
