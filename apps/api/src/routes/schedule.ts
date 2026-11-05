import {
  scheduleQuerySchema,
  scheduleRequestSchema,
  sessionStatusSchema,
  type ScheduleClass,
  type ScheduleResponse,
  type ScheduleSession,
  type SessionStatus,
} from "@tutlab/shared";
import type { PostgrestError } from "@supabase/supabase-js";
import { Hono } from "hono";
import { z } from "zod";
import { createRequestClient, currentAuth, type AppEnv } from "../lib/auth";
import { ApiError, forbidden, notFound } from "../lib/errors";
import { parseInput, parseJson } from "../schemas/requests";
import { sessionDayRange } from "./today";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DURATION_MS = 15 * 60 * 1000;
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;

interface ScheduleClassRow {
  id: string;
  name: string;
  campus: string;
  teacher_id: string;
  courses: { subject: string; level: string } | null;
  teacher: { display_name: string } | null;
}

interface ScheduleSessionRow {
  id: string;
  class_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  classes: {
    name: string;
    campus: string;
    teacher_id: string;
    courses: { subject: string; level: string } | null;
    teacher: { display_name: string } | null;
  } | null;
  session_students: { student_id: string }[];
}

interface StudentRow {
  id: string;
  status: string;
  service_owner_id: string;
}

function calendarDateMs(value: string): number | null {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp;
}

function sessionStatus(value: string): SessionStatus {
  const parsed = sessionStatusSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid session status");
  return parsed.data;
}

function schedulingError(error: PostgrestError): ApiError | null {
  const description = `${error.message} ${error.details}`;
  if (error.code === "23P01" || description.includes("sessions_teacher_no_overlap")) {
    return new ApiError("VALIDATION_FAILED", 422, "教师时间冲突，该教师在此时间段已有课次");
  }
  if (error.code === "23505" && description.includes("session_students_one_trial_per_student_idx")) {
    return new ApiError("VALIDATION_FAILED", 422, "该学生已有试听记录，不能重复安排试听");
  }
  if (error.code === "23505" && description.includes("enrollments_one_active_per_student_class_idx")) {
    return new ApiError("VALIDATION_FAILED", 422, "该学生已有此班级的有效入班记录");
  }
  if (description.includes("NOT_FOUND")) return notFound();
  if (description.includes("VALIDATION_FAILED")) {
    return new ApiError("VALIDATION_FAILED", 422, "排课信息未通过校验");
  }
  return null;
}

export const scheduleRoute = new Hono<AppEnv>()
  .get("/", async (c) => {
    const query = parseInput(scheduleQuerySchema, c.req.query());
    const fromMs = calendarDateMs(query.from);
    const toMs = calendarDateMs(query.to);
    if (fromMs === null) {
      throw new ApiError("VALIDATION_FAILED", 422, "from 不是有效日期", { from: query.from });
    }
    if (toMs === null) {
      throw new ApiError("VALIDATION_FAILED", 422, "to 不是有效日期", { to: query.to });
    }
    if (fromMs >= toMs) {
      throw new ApiError("VALIDATION_FAILED", 422, "from 必须早于排他日期 to");
    }
    if (toMs - fromMs > 31 * DAY_MS) {
      throw new ApiError("VALIDATION_FAILED", 422, "查询范围不能超过 31 天");
    }

    const start = sessionDayRange(query.from, c.env).start;
    const end = sessionDayRange(query.to, c.env).start;
    const supabase = createRequestClient(c);
    const [sessionResult, classResult] = await Promise.all([
      supabase
        .from("sessions")
        .select("id,class_id,starts_at,ends_at,status,classes!inner(name,campus,teacher_id,courses!inner(subject,level),teacher:profiles!classes_teacher_id_fkey(display_name)),session_students(student_id)")
        .gte("starts_at", start)
        .lt("starts_at", end)
        .order("starts_at"),
      supabase
        .from("classes")
        .select("id,name,campus,teacher_id,courses!inner(subject,level),teacher:profiles!classes_teacher_id_fkey(display_name)")
        .order("name"),
    ]);
    if (sessionResult.error) throw new Error(sessionResult.error.message);
    if (classResult.error) throw new Error(classResult.error.message);

    const sessionRows = (sessionResult.data ?? []) as unknown as ScheduleSessionRow[];
    const classRows = (classResult.data ?? []) as unknown as ScheduleClassRow[];
    const response: ScheduleResponse = {
      from: query.from,
      to: query.to,
      sessions: sessionRows.map((row): ScheduleSession => ({
        id: row.id,
        class_id: row.class_id,
        class_name: row.classes?.name ?? "",
        subject: row.classes?.courses?.subject ?? "",
        level: row.classes?.courses?.level ?? "",
        teacher_id: row.classes?.teacher_id ?? "",
        teacher_name: row.classes?.teacher?.display_name ?? "",
        campus: row.classes?.campus ?? "",
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: sessionStatus(row.status),
        student_count: row.session_students.length,
      })),
      classes: classRows.map((row): ScheduleClass => ({
        id: row.id,
        name: row.name,
        subject: row.courses?.subject ?? "",
        level: row.courses?.level ?? "",
        teacher_id: row.teacher_id,
        teacher_name: row.teacher?.display_name ?? "",
        campus: row.campus,
      })),
    };
    return c.json(response);
  })
  .post("/", async (c) => {
    const { profile } = currentAuth(c);
    if (profile.role !== "admin" && profile.role !== "manager") throw forbidden();
    const body = await parseJson(scheduleRequestSchema, c.req.raw);
    if (body.kind === "trial" && !body.student_id) {
      throw new ApiError("VALIDATION_FAILED", 422, "试听必须选择学生", { student_id: "Required for trial sessions" });
    }

    const startsAtMs = Date.parse(body.starts_at);
    const endsAtMs = Date.parse(body.ends_at);
    if (endsAtMs <= startsAtMs) {
      throw new ApiError("VALIDATION_FAILED", 422, "结束时间必须晚于开始时间");
    }
    if (startsAtMs <= Date.now()) {
      throw new ApiError("VALIDATION_FAILED", 422, "开始时间必须晚于当前时间");
    }
    const durationMs = endsAtMs - startsAtMs;
    if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
      throw new ApiError("VALIDATION_FAILED", 422, "课次时长必须在 15 分钟到 4 小时之间");
    }

    const supabase = createRequestClient(c);
    const { data: classData, error: classError } = await supabase
      .from("classes")
      .select("id")
      .eq("id", body.class_id)
      .maybeSingle();
    if (classError) throw new Error(classError.message);
    if (!classData) throw notFound();

    if (body.student_id) {
      const { data, error } = await supabase
        .from("students")
        .select("id,status,service_owner_id")
        .eq("id", body.student_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw notFound();
      const student = data as StudentRow;
      if (profile.role === "admin" && student.service_owner_id !== profile.id) throw forbidden();
      if (student.status !== "active") {
        throw new ApiError("VALIDATION_FAILED", 422, "仅可为在读学生安排课次", { student_id: student.id });
      }
    }

    const { data, error } = await supabase.rpc("schedule_session", {
      p_kind: body.kind,
      p_class_id: body.class_id,
      p_student_id: body.student_id ?? null,
      p_starts_at: body.starts_at,
      p_ends_at: body.ends_at,
    });
    if (error) {
      const mapped = schedulingError(error);
      if (mapped) throw mapped;
      throw new Error(error.message);
    }
    const sessionId = z.string().uuid().safeParse(data);
    if (!sessionId.success) throw new Error("Invalid schedule function result");
    return c.json({ session_id: sessionId.data }, 201);
  });
