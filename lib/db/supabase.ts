import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Persistence is optional: without Supabase env vars Foundry still plans and
// streams logs, it just doesn't store projects. Callers must handle null —
// never a silently broken client pointed at an empty URL.
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}
