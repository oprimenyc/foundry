import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, validateLoginToken } from "@/lib/foundry/auth";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ token: z.string().min(1).max(512) });

// public: this is the authenticator — it exchanges the API token for a session cookie.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  if (!validateLoginToken(parsed.data.token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, parsed.data.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}

// public: logout only clears the caller's own cookie.
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
