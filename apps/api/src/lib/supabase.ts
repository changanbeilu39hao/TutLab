import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkerEnv } from "./auth";

export function createAdminClient(env: WorkerEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function requireData<T>(data: T | null): T {
  if (data === null) {
    throw new Error("Expected database data");
  }
  return data;
}
