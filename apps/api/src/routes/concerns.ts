import { resolveConcernRequestSchema, type ConcernLevel, type ConcernsResponse } from "@tutlab/shared";
import { Hono } from "hono";
import { createRequestClient, currentAuth, type AppEnv } from "../lib/auth";
import { forbidden, notFound } from "../lib/errors";
import { idParamSchema, parseInput, parseJson } from "../schemas/requests";

interface ConcernRow {
  id: string;
  level: ConcernLevel;
  reason: string;
  students: {
    name: string;
    owner: { display_name: string } | null;
  } | null;
  sessions: { classes: { name: string } | null } | null;
}

function requireConcernRole(role: string): void {
  if (role !== "admin" && role !== "manager") throw forbidden();
}

export const concernsRoute = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { profile } = currentAuth(c);
    requireConcernRole(profile.role);
    const supabase = createRequestClient(c);
    const { data, error } = await supabase
      .from("concerns")
      .select("id,level,reason,students!inner(name,owner:profiles!students_service_owner_id_fkey(display_name)),sessions(classes(name))")
      .is("resolved_at", null)
      .order("level")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as ConcernRow[];
    const response: ConcernsResponse = {
      items: rows.map((row) => ({
        id: row.id,
        student_name: row.students?.name ?? "",
        level: row.level,
        reason: row.reason,
        class_name: row.sessions?.classes?.name ?? "",
        owner: row.students?.owner?.display_name ?? "",
      })),
    };
    return c.json(response);
  })
  .patch("/:id", async (c) => {
    const { profile } = currentAuth(c);
    requireConcernRole(profile.role);
    const id = parseInput(idParamSchema, c.req.param("id"));
    const body = await parseJson(resolveConcernRequestSchema, c.req.raw);
    const supabase = createRequestClient(c);
    const { data, error } = await supabase
      .from("concerns")
      .update({ resolved_at: body.resolved ? new Date().toISOString() : null })
      .eq("id", id)
      .is("resolved_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound();
    return c.json({ ok: true });
  });
