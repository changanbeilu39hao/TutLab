import {
  attendanceRequestSchema,
  createFeedbackRequestSchema,
  rawStatusSchema,
  sessionStatusSchema,
  updateFeedbackRequestSchema,
  type AttendanceResponse,
  type CreateFeedbackResponse,
  type FeedbackOutput,
  type RawStatus,
  type RosterStudent,
  type SessionResponse,
  type SessionStatus,
} from "@tutlab/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { createRequestClient, currentAuth, type AppEnv, type AuthContext } from "../lib/auth";
import { ApiError, forbidden, notFound, validation } from "../lib/errors";
import { generateFeedback, LlmUnavailableError, type LlmRosterStudent } from "../lib/llm";
import { idParamSchema, parseInput, parseJson } from "../schemas/requests";
import { parseLlmFeedback, requireMatchedStudents, sanitizeFeedback } from "../schemas/feedback";

interface SessionRow {
  id: string;
  teacher_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  classes: {
    name: string;
    courses: { subject: string; level: string } | null;
  } | null;
}

interface RosterRow {
  student_id: string;
  is_new: boolean;
  is_trial: boolean;
  students: { name: string } | null;
}

interface RosterEntry extends LlmRosterStudent {
  is_new: boolean;
  is_trial: boolean;
}

interface RawRow {
  id: string;
  raw_text: string;
  status: string;
}

const rpcResultSchema = z.object({
  attendance_id: z.string().uuid(),
  deducted: z.number().int().min(0).max(1),
  balance_after: z.number().int().nonnegative(),
});

async function sessionForRequest(c: Context<AppEnv>, id: string): Promise<SessionRow> {
  const auth = currentAuth(c);
  const supabase = createRequestClient(c);
  let query = supabase
    .from("sessions")
    .select("id,teacher_id,starts_at,ends_at,status,classes!inner(name,courses!inner(subject,level))")
    .eq("id", id);
  if (auth.profile.role === "teacher") query = query.eq("teacher_id", auth.profile.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as unknown as SessionRow;

  const { data: exists, error: existsError } = await supabase.from("sessions").select("id").eq("id", id).maybeSingle();
  if (existsError) throw new Error(existsError.message);
  if (exists) throw forbidden();
  throw notFound();
}

async function rosterForSession(supabase: SupabaseClient, sessionId: string): Promise<RosterEntry[]> {
  const { data, error } = await supabase
    .from("session_students")
    .select("student_id,is_new,is_trial,students!inner(name)")
    .eq("session_id", sessionId)
    .order("student_id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RosterRow[]).map((row) => ({
    student_id: row.student_id,
    name: row.students?.name ?? "",
    is_new: row.is_new,
    is_trial: row.is_trial,
  }));
}

async function balancesForStudents(supabase: SupabaseClient, studentIds: string[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (studentIds.length === 0) return balances;
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("student_id,balance_after,created_at,id")
    .in("student_id", studentIds)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { student_id: string; balance_after: number }[]) {
    if (!balances.has(row.student_id)) balances.set(row.student_id, row.balance_after);
  }
  return balances;
}

function parseRawStatus(value: string): RawStatus {
  const parsed = rawStatusSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid raw feedback status");
  return parsed.data;
}

async function feedbackForSession(
  supabase: SupabaseClient,
  auth: AuthContext,
  sessionId: string,
): Promise<SessionResponse["feedback"]> {
  let rawQuery = supabase
    .from("feedback_raw")
    .select("id,raw_text,status")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (auth.profile.role === "teacher") rawQuery = rawQuery.eq("teacher_id", auth.profile.id);
  const { data: rawData, error: rawError } = await rawQuery.maybeSingle();
  if (rawError) throw new Error(rawError.message);
  if (!rawData) return null;
  const raw = rawData as RawRow;

  const [studentResult, noteResult, parentResult, concernResult] = await Promise.all([
    supabase
      .from("student_feedback")
      .select("student_id,mastery,observation,flags")
      .eq("feedback_raw_id", raw.id)
      .order("created_at"),
    supabase
      .from("student_notes")
      .select("covered,homework,class_note")
      .eq("feedback_raw_id", raw.id)
      .maybeSingle(),
    supabase
      .from("parent_messages")
      .select("student_id,body,state")
      .eq("feedback_raw_id", raw.id)
      .order("id"),
    supabase
      .from("concerns")
      .select("student_id,level,reason")
      .eq("session_id", sessionId)
      .order("created_at"),
  ]);
  if (studentResult.error) throw new Error(studentResult.error.message);
  if (noteResult.error) throw new Error(noteResult.error.message);
  if (parentResult.error) throw new Error(parentResult.error.message);
  if (concernResult.error) throw new Error(concernResult.error.message);

  let items: FeedbackOutput | null = null;
  if (parseRawStatus(raw.status) === "parsed" && noteResult.data) {
    const note = noteResult.data as { covered: string[]; homework: string | null; class_note: string | null };
    items = {
      covered: note.covered,
      per_student: (studentResult.data ?? []) as FeedbackOutput["per_student"],
      homework: note.homework,
      class_note: note.class_note,
      parent_messages: (parentResult.data ?? []) as FeedbackOutput["parent_messages"],
      concerns: (concernResult.data ?? []) as FeedbackOutput["concerns"],
    };
  }
  return { raw_id: raw.id, raw_text: raw.raw_text, status: parseRawStatus(raw.status), items };
}

async function saveFeedback(
  supabase: SupabaseClient,
  rawId: string,
  sessionId: string,
  teacherId: string,
  output: FeedbackOutput,
  replace: boolean,
): Promise<void> {
  if (replace) {
    const deletions = await Promise.all([
      supabase.from("student_feedback").delete().eq("feedback_raw_id", rawId),
      supabase.from("student_notes").delete().eq("feedback_raw_id", rawId),
      supabase.from("parent_messages").delete().eq("feedback_raw_id", rawId),
      supabase.from("concerns").delete().eq("session_id", sessionId),
    ]);
    const failed = deletions.find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
  }

  const { error: rawError } = await supabase
    .from("feedback_raw")
    .update({ status: "parsed", error: null, teacher_id: teacherId })
    .eq("id", rawId)
    .eq("session_id", sessionId);
  if (rawError) throw new Error(rawError.message);

  if (output.per_student.length > 0) {
    const { error } = await supabase.from("student_feedback").insert(output.per_student.map((item) => ({
      feedback_raw_id: rawId,
      student_id: item.student_id,
      mastery: item.mastery,
      observation: item.observation,
      flags: item.flags,
    })));
    if (error) throw new Error(error.message);
  }

  const { error: noteError } = await supabase.from("student_notes").insert({
    feedback_raw_id: rawId,
    covered: output.covered,
    homework: output.homework,
    class_note: output.class_note,
  });
  if (noteError) throw new Error(noteError.message);

  if (output.parent_messages.length > 0) {
    const { error } = await supabase.from("parent_messages").insert(output.parent_messages.map((item) => ({
      feedback_raw_id: rawId,
      student_id: item.student_id,
      body: item.body,
      state: item.state ?? "draft",
    })));
    if (error) throw new Error(error.message);
  }

  if (output.concerns.length > 0) {
    const { error } = await supabase.from("concerns").insert(output.concerns.map((item) => ({
      student_id: item.student_id,
      session_id: sessionId,
      level: item.level,
      reason: item.reason,
    })));
    if (error) throw new Error(error.message);
  }
}

function attendanceError(message: string): ApiError {
  if (message.includes("INSUFFICIENT_CREDITS")) return new ApiError("INSUFFICIENT_CREDITS", 422);
  if (message.includes("SESSION_LOCKED")) return new ApiError("SESSION_LOCKED", 423);
  if (message.includes("NOT_IN_ROSTER")) return new ApiError("NOT_IN_ROSTER", 422);
  if (message.includes("NOT_FOUND")) return new ApiError("NOT_FOUND", 404);
  return new ApiError("VALIDATION_FAILED", 422, message);
}

export const sessionsRoute = new Hono<AppEnv>()
  .get("/:id", async (c) => {
    const id = parseInput(idParamSchema, c.req.param("id"));
    const session = await sessionForRequest(c, id);
    const status = sessionStatusSchema.safeParse(session.status);
    if (!status.success) throw new Error("Invalid session status");
    const auth = currentAuth(c);
    const supabase = createRequestClient(c);
    const roster = await rosterForSession(supabase, id);
    const [balances, attendanceResult, feedback] = await Promise.all([
      balancesForStudents(supabase, roster.map((student) => student.student_id)),
      supabase
        .from("attendance")
        .select("student_id,status,credits_deducted")
        .eq("session_id", id),
      feedbackForSession(supabase, auth, id),
    ]);
    if (attendanceResult.error) throw new Error(attendanceResult.error.message);
    const attendance = new Map(
      ((attendanceResult.data ?? []) as { student_id: string; status: string; credits_deducted: number }[])
        .map((item) => [item.student_id, item]),
    );
    const response: SessionResponse = {
      session: {
        id: session.id,
        class_name: session.classes?.name ?? "",
        subject: session.classes?.courses?.subject ?? "",
        level: session.classes?.courses?.level ?? "",
        starts_at: session.starts_at,
        ends_at: session.ends_at,
        status: status.data as SessionStatus,
      },
      roster: roster.map((student): RosterStudent => {
        const marked = attendance.get(student.student_id);
        const parsedAttendance = marked
          ? z.object({ status: z.enum(["present", "absent", "leave", "trial"]) }).safeParse(marked)
          : null;
        return {
          student_id: student.student_id,
          name: student.name,
          is_new: student.is_new,
          is_trial: student.is_trial,
          balance: balances.get(student.student_id) ?? 0,
          attendance: parsedAttendance?.success && marked
            ? { status: parsedAttendance.data.status, deducted: marked.credits_deducted }
            : null,
        };
      }),
      feedback,
    };
    return c.json(response);
  })
  .put("/:id/attendance", async (c) => {
    const id = parseInput(idParamSchema, c.req.param("id"));
    await sessionForRequest(c, id);
    const body = await parseJson(attendanceRequestSchema, c.req.raw);
    const auth = currentAuth(c);
    const supabase = createRequestClient(c);
    const roster = await rosterForSession(supabase, id);
    const allowed = new Set(roster.map((student) => student.student_id));
    const requested = new Set<string>();
    for (const item of body.items) {
      if (!allowed.has(item.student_id)) {
        throw new ApiError("NOT_IN_ROSTER", 422, undefined, { student_id: item.student_id });
      }
      if (requested.has(item.student_id)) throw validation({ student_id: item.student_id });
      requested.add(item.student_id);
    }

    const results: AttendanceResponse["results"] = [];
    for (const item of body.items) {
      const { data, error } = await supabase.rpc("mark_attendance", {
        p_session_id: id,
        p_student_id: item.student_id,
        p_status: item.status,
        p_marked_by: auth.profile.id,
      });
      if (error) throw attendanceError(error.message);
      const parsed = rpcResultSchema.safeParse(data);
      if (!parsed.success) throw new Error("Invalid attendance function result");
      if (item.remark !== undefined) {
        const { error: remarkError } = await supabase
          .from("attendance")
          .update({ remark: item.remark })
          .eq("id", parsed.data.attendance_id);
        if (remarkError) throw new Error(remarkError.message);
      }
      results.push({
        student_id: item.student_id,
        deducted: parsed.data.deducted,
        balance_after: parsed.data.balance_after,
      });
    }
    return c.json({ results } satisfies AttendanceResponse);
  })
  .post("/:id/feedback", async (c) => {
    const id = parseInput(idParamSchema, c.req.param("id"));
    await sessionForRequest(c, id);
    const body = await parseJson(createFeedbackRequestSchema, c.req.raw);
    const auth = currentAuth(c);
    const supabase = createRequestClient(c);
    const roster = await rosterForSession(supabase, id);
    const { data: rawData, error: rawInsertError } = await supabase
      .from("feedback_raw")
      .insert({
        session_id: id,
        teacher_id: auth.profile.id,
        raw_text: body.raw_text,
        model: c.env.DEEPSEEK_MODEL,
        status: "failed",
      })
      .select("id")
      .single();
    if (rawInsertError || !rawData) throw new Error(rawInsertError?.message ?? "Could not save raw feedback");
    const rawId = (rawData as { id: string }).id;

    let generated: unknown;
    try {
      generated = await generateFeedback(c.env, body.raw_text, roster);
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      const { error: updateError } = await supabase
        .from("feedback_raw")
        .update({ status: "fallback", error: error.message })
        .eq("id", rawId);
      if (updateError) throw new Error(updateError.message);
      const response: CreateFeedbackResponse = { raw_id: rawId, status: "fallback", parsed: null, unmatched: [] };
      return c.json(response);
    }

    let parsed: FeedbackOutput;
    try {
      parsed = parseLlmFeedback(generated);
    } catch (error) {
      if (error instanceof ApiError) {
        await supabase.from("feedback_raw").update({ status: "failed", error: error.message }).eq("id", rawId);
      }
      throw error;
    }
    const sanitized = sanitizeFeedback(parsed, roster);
    if (roster.length > 0 && sanitized.output.per_student.length === 0) {
      const { error } = await supabase
        .from("feedback_raw")
        .update({ status: "fallback", error: "No roster students matched" })
        .eq("id", rawId);
      if (error) throw new Error(error.message);
      const response: CreateFeedbackResponse = {
        raw_id: rawId,
        status: "fallback",
        parsed: null,
        unmatched: sanitized.unmatched,
      };
      return c.json(response);
    }
    await saveFeedback(supabase, rawId, id, auth.profile.id, sanitized.output, false);
    const response: CreateFeedbackResponse = {
      raw_id: rawId,
      status: "parsed",
      parsed: sanitized.output,
      unmatched: sanitized.unmatched,
    };
    return c.json(response);
  })
  .put("/:id/feedback", async (c) => {
    const id = parseInput(idParamSchema, c.req.param("id"));
    await sessionForRequest(c, id);
    const body = await parseJson(updateFeedbackRequestSchema, c.req.raw);
    const auth = currentAuth(c);
    const supabase = createRequestClient(c);
    const { data: raw, error: rawError } = await supabase
      .from("feedback_raw")
      .select("id")
      .eq("id", body.raw_id)
      .eq("session_id", id)
      .eq("teacher_id", auth.profile.id)
      .maybeSingle();
    if (rawError) throw new Error(rawError.message);
    if (!raw) throw notFound();
    const roster = await rosterForSession(supabase, id);
    const sanitized = sanitizeFeedback(body.edited, roster, true);
    requireMatchedStudents(sanitized.unmatched);
    await saveFeedback(supabase, body.raw_id, id, auth.profile.id, sanitized.output, true);
    return c.json({ ok: true });
  });
