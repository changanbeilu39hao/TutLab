import { roleSchema, type Profile } from "@tutlab/shared";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createAdminClient } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unauthorized } from "./errors";

export interface WorkerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  APP_TZ: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL: string;
  DEEPSEEK_MODEL: string;
  LLM_TIMEOUT_MS?: string;
  LLM_MAX_TOKENS?: string;
  LLM_TEMPERATURE?: string;
  IMPERSONATION_TTL_MIN?: string;
  DEBUG_LLM?: string;
}

export interface AuthContext {
  profile: Profile;
  claims: JWTPayload;
  actor: string | null;
  jti: string | null;
  mode: "jwt" | "header";
}

export interface AppVariables {
  auth: AuthContext;
}

export type AppEnv = {
  Bindings: WorkerEnv;
  Variables: AppVariables;
};

type AppContext = Context<AppEnv>;

let modeCheck: Promise<"jwt" | "header"> | undefined;

function secretKey(env: WorkerEnv): Uint8Array {
  return new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
}

async function signToken(
  env: WorkerEnv,
  subject: string,
  claims: Record<string, unknown>,
  expiresInSeconds: number,
): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + expiresInSeconds) * 1000);
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(subject)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(secretKey(env));
  return { token, expiresAt };
}

async function detectMode(env: WorkerEnv): Promise<"jwt" | "header"> {
  const supabase = createAdminClient(env);
  const { data: profile } = await supabase.from("profiles").select("id").limit(1).maybeSingle();
  const profileId = (profile as { id: string } | null)?.id;
  if (!profileId) return "jwt";

  const jti = crypto.randomUUID();
  const { token } = await signToken(env, profileId, {
    role: "authenticated",
    app_role: "teacher",
    jti,
  }, 60);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
  });
  if (response.ok) return "jwt";

  console.warn("Supabase rejected the HS256 token; using x-act-as compatibility mode.");
  return "header";
}

function authMode(env: WorkerEnv): Promise<"jwt" | "header"> {
  modeCheck ??= detectMode(env).catch((error: unknown) => {
    console.warn("Supabase signing self-check failed; using x-act-as compatibility mode.", error);
    return "header";
  });
  return modeCheck;
}

async function loadProfile(env: WorkerEnv, id: string): Promise<Profile> {
  const supabase = createAdminClient(env);
  const { data, error } = await supabase
    .from("profiles")
    .select("id,role,display_name,campus")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    console.error("Profile authorization lookup failed", error?.message ?? "profile not found", id);
    throw unauthorized();
  }
  const row = data as { id: string; role: string; display_name: string; campus: string };
  const role = roleSchema.safeParse(row.role);
  if (!role.success) throw unauthorized();
  return { id: row.id, role: role.data, display_name: row.display_name, campus: row.campus };
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  const token = header.slice(7).trim();
  if (!token) throw unauthorized();

  const mode = await authMode(c.env);
  let claims: JWTPayload;
  let subject: string;

  if (mode === "jwt") {
    try {
      const verified = await jwtVerify(token, secretKey(c.env), { audience: "authenticated" });
      claims = verified.payload;
      if (!claims.sub) throw new Error("Missing subject");
      subject = claims.sub;
    } catch {
      const supabase = createAdminClient(c.env);
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        console.error("Supabase user verification failed", error?.message ?? "user not found");
        throw unauthorized();
      }
      subject = data.user.id;
      claims = { sub: subject };
    }
  } else {
    let locallyVerified: JWTPayload | null = null;
    try {
      const verified = await jwtVerify(token, secretKey(c.env), { audience: "authenticated" });
      locallyVerified = verified.payload;
    } catch {
      locallyVerified = null;
    }

    if (locallyVerified?.act && locallyVerified.sub) {
      claims = locallyVerified;
      subject = locallyVerified.sub;
    } else {
      const supabase = createAdminClient(c.env);
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        console.error("Supabase user verification failed", error?.message ?? "user not found");
        throw unauthorized();
      }
      subject = data.user.id;
      claims = { sub: subject };
    }
  }

  const actor = typeof claims.act === "string" ? claims.act : null;
  const jti = typeof claims.jti === "string" ? claims.jti : null;
  const profile = await loadProfile(c.env, subject);
  c.set("auth", { profile, claims, actor, jti, mode });
  if (actor) c.header("x-impersonated-by", actor);
  await next();
});

export async function issueImpersonationToken(
  env: WorkerEnv,
  actor: string,
  teacher: string,
  jti: string,
  ttlMinutes: number,
): Promise<{ token: string; expiresAt: Date }> {
  return signToken(env, teacher, {
    role: "authenticated",
    app_role: "teacher",
    act: actor,
    jti,
  }, ttlMinutes * 60);
}

export function currentAuth(c: AppContext): AuthContext {
  return c.get("auth");
}

export function createRequestClient(c: AppContext): SupabaseClient {
  const auth = currentAuth(c);
  const actAs = auth.mode === "header" && auth.actor ? auth.profile.id : undefined;
  return createAdminClient(c.env, actAs);
}

