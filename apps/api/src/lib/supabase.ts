import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkerEnv } from "./auth";

export function createAdminClient(env: WorkerEnv, actAs?: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: actAs ? { "x-act-as": actAs } : {} },
  });
}

