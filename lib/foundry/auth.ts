import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "foundry_session";

/** Authenticated caller identity: every authorized request resolves to one. */
export interface Principal {
  id: string;
  orgId: string;
  role: "admin" | "operator";
}

interface PrincipalEntry extends Principal {
  token: string;
}

export const LOCAL_DEV_PRINCIPAL: Principal = { id: "dev-local", orgId: "org_local", role: "admin" };

function configuredToken(): string | undefined {
  const token = process.env.FOUNDRY_API_TOKEN;
  return token && token.length >= 16 ? token : undefined;
}

/**
 * Principal registry. Two configuration shapes:
 * - FOUNDRY_PRINCIPALS: JSON array of {token, id, orgId, role} for multi-org /
 *   service-client setups (Chief of Staff, VERIDIAN each get their own token
 *   and org scope).
 * - FOUNDRY_API_TOKEN: single-owner shortcut mapping to principal "owner" in
 *   FOUNDRY_ORG_ID (default org_local).
 * Malformed FOUNDRY_PRINCIPALS fails closed (no principals authenticate).
 */
function configuredPrincipals(): PrincipalEntry[] {
  const raw = process.env.FOUNDRY_PRINCIPALS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PrincipalEntry[];
      return parsed.filter(
        (entry) =>
          typeof entry.token === "string" &&
          entry.token.length >= 16 &&
          typeof entry.id === "string" &&
          typeof entry.orgId === "string" &&
          (entry.role === "admin" || entry.role === "operator")
      );
    } catch {
      console.error("[foundry] FOUNDRY_PRINCIPALS is not valid JSON — no principals will authenticate");
      return [];
    }
  }
  const single = configuredToken();
  if (single) {
    return [{ token: single, id: "owner", orgId: process.env.FOUNDRY_ORG_ID || "org_local", role: "admin" }];
  }
  return [];
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

function principalForRequest(req: Request): Principal | null {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const cookie = readCookie(req, SESSION_COOKIE);
  for (const entry of configuredPrincipals()) {
    if (tokenMatches(bearer, entry.token) || tokenMatches(cookie, entry.token)) {
      return { id: entry.id, orgId: entry.orgId, role: entry.role };
    }
  }
  return null;
}

export type AuthResult = { ok: true; principal: Principal } | { ok: false; response: NextResponse };

/**
 * Auth gate for API routes; resolves the caller to a Principal.
 *
 * - Principals configured: requests need a matching token as a Bearer header
 *   or session cookie (cookie exists because EventSource cannot send headers).
 * - No principals in production: fail closed with 503 — never silently open.
 * - No principals in dev/test: open, mapped to the explicit local-dev
 *   bootstrap principal (org_local).
 */
export function resolvePrincipal(req: Request): AuthResult {
  const principals = configuredPrincipals();
  if (principals.length === 0) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "No API principals configured (FOUNDRY_API_TOKEN or FOUNDRY_PRINCIPALS); API is disabled in production" },
          { status: 503 }
        ),
      };
    }
    return { ok: true, principal: LOCAL_DEV_PRINCIPAL };
  }
  const principal = principalForRequest(req);
  if (principal) return { ok: true, principal };
  return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
}

/** Back-compat shim: null means proceed. Prefer resolvePrincipal in routes. */
export function requireApiAuth(req: Request): NextResponse | null {
  const result = resolvePrincipal(req);
  return result.ok ? null : result.response;
}

/** Validates a login attempt for any configured principal. */
export function validateLoginToken(token: string): boolean {
  return configuredPrincipals().some((entry) => tokenMatches(token, entry.token));
}

export function authMode(): "token" | "open-dev" | "misconfigured" {
  if (configuredPrincipals().length > 0) return "token";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "open-dev";
}
