import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "foundry_session";

function configuredToken(): string | undefined {
  const token = process.env.FOUNDRY_API_TOKEN;
  return token && token.length >= 16 ? token : undefined;
}

function tokenMatches(candidate: string | undefined | null, expected: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function isAuthenticated(req: Request): boolean {
  const expected = configuredToken();
  if (!expected) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return tokenMatches(bearer, expected) || tokenMatches(readCookie(req, SESSION_COOKIE), expected);
}

/**
 * Auth gate for API routes. Returns a Response to short-circuit with, or null
 * when the request may proceed.
 *
 * - FOUNDRY_API_TOKEN set (>=16 chars): requests need it as a Bearer header or
 *   session cookie (cookie exists because EventSource cannot send headers).
 * - Token missing in production: fail closed with 503 — never silently open.
 * - Token missing in dev/test: open, for local iteration.
 */
export function requireApiAuth(req: Request): NextResponse | null {
  const expected = configuredToken();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "FOUNDRY_API_TOKEN is not configured (min 16 chars); API is disabled in production without it" },
        { status: 503 }
      );
    }
    return null;
  }
  if (isAuthenticated(req)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Validates a login attempt and returns the cookie value to set, or null. */
export function validateLoginToken(token: string): boolean {
  const expected = configuredToken();
  return expected ? tokenMatches(token, expected) : false;
}

export function authMode(): "token" | "open-dev" | "misconfigured" {
  if (configuredToken()) return "token";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "open-dev";
}
