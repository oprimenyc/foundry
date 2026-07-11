import { requireApiAuth } from "@/lib/foundry/auth";
import { NextResponse } from "next/server";
import { requestCancellation } from "@/lib/foundry/execution";

export async function POST(req: Request, { params }: { params: { id: string; runId: string } }) {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  await requestCancellation(params.runId);
  return NextResponse.json({ ok: true }, { status: 202 });
}
