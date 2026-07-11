import { requireApiAuth } from "@/lib/foundry/auth";
import { NextResponse } from "next/server";
import { getRunView } from "@/lib/foundry/service";

export async function GET(req: Request, { params }: { params: { id: string; runId: string } }) {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const view = await getRunView(params.id, params.runId);
  if (!view) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(view);
}
