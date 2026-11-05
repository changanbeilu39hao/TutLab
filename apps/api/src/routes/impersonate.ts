import {
  endImpersonationRequestSchema,
  impersonateRequestSchema,
  type ImpersonationResponse,
  type ImpersonationTargetsResponse,
  type TeacherTarget,
} from "@tutlab/shared";
import { Hono } from "hono";
import { createRequestClient, currentAuth, issueImpersonationToken, type AppEnv } from "../lib/auth";
import { forbidden, notFound } from "../lib/errors";
import { parseJson } from "../schemas/requests";

function requireAdministrator(role: string): void {
  if (role !== "admin" && role !== "manager") throw forbidden();
}

function ttlMinutes(value: string | undefined): number {
  const parsed = Number(value ?? 30);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export const impersonateRoute = new Hono<AppEnv>()
  .get("/targets", async (c) => {
    const auth = currentAuth(c);
    if (auth.actor) throw forbidden("NESTED_IMPERSONATION");
    requireAdministrator(auth.profile.role);
    const supabase = createRequestClient(c);
    let query = supabase
      .from("profiles")
      .select("id,display_name,campus")
      .eq("role", "teacher")
      .order("display_name");
    if (auth.profile.role === "admin") query = query.eq("campus", auth.profile.campus);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const response: ImpersonationTargetsResponse = { teachers: (data ?? []) as TeacherTarget[] };
    return c.json(response);
  })
  .post("/", async (c) => {
    const auth = currentAuth(c);
    if (auth.actor) throw forbidden("NESTED_IMPERSONATION");
    requireAdministrator(auth.profile.role);
    const body = await parseJson(impersonateRequestSchema, c.req.raw);
    const supabase = createRequestClient(c);
    const [{ data: target, error: targetError }, { data: active, error: activeError }] = await Promise.all([
      supabase.from("profiles").select("id,role,display_name,campus").eq("id", body.teacher_id).maybeSingle(),
      supabase
        .from("impersonation_log")
        .select("id")
        .eq("actor_id", auth.profile.id)
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString())
        .limit(1),
    ]);
    if (targetError || activeError) throw new Error(targetError?.message ?? activeError?.message);
    const teacher = target as (TeacherTarget & { role: string }) | null;
    if (!teacher) throw notFound();
    if (teacher.role !== "teacher") throw forbidden();
    if (auth.profile.role === "admin" && teacher.campus !== auth.profile.campus) throw forbidden();
    if (active && active.length > 0) throw forbidden();

    const jti = crypto.randomUUID();
    const issued = await issueImpersonationToken(
      c.env,
      auth.profile.id,
      teacher.id,
      jti,
      ttlMinutes(c.env.IMPERSONATION_TTL_MIN),
    );
    const { error: insertError } = await supabase.from("impersonation_log").insert({
      actor_id: auth.profile.id,
      subject_id: teacher.id,
      token_jti: jti,
      expires_at: issued.expiresAt.toISOString(),
    });
    if (insertError) throw new Error(insertError.message);
    const response: ImpersonationResponse = {
      token: issued.token,
      expires_at: issued.expiresAt.toISOString(),
      teacher: { id: teacher.id, display_name: teacher.display_name, campus: teacher.campus },
    };
    return c.json(response);
  })
  .post("/end", async (c) => {
    const auth = currentAuth(c);
    const body = await parseJson(endImpersonationRequestSchema, c.req.raw);
    const actorId = auth.actor ?? auth.profile.id;
    const supabase = createRequestClient(c);
    const { data, error } = await supabase
      .from("impersonation_log")
      .update({ ended_at: new Date().toISOString() })
      .eq("token_jti", body.jti)
      .eq("actor_id", actorId)
      .is("ended_at", null)
      .select("token_jti")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound();
    return c.json({ ok: true });
  });
