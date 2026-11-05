import { todayQuerySchema, type SessionStatus, type TodayResponse } from "@tutlab/shared";
import { Hono } from "hono";
import { createRequestClient, currentAuth, type AppEnv, type WorkerEnv } from "../lib/auth";
import { forbidden, validation } from "../lib/errors";
import { parseInput } from "../schemas/requests";

interface DateParts {
  year: number;
  month: number;
  day: number;
}

interface TodayRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: SessionStatus;
  classes: {
    name: string;
    courses: { subject: string; level: string } | null;
  } | null;
  session_students: { student_id: string; is_new: boolean }[];
}

function dateParts(date: string): DateParts {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw validation();
  return { year, month, day };
}

function partsInZone(value: Date, timeZone: string): DateParts & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function zoneDateToUtc(date: string, timeZone: string): Date {
  const { year, month, day } = dateParts(date);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const local = partsInZone(new Date(guess), timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    guess += target - represented;
  }
  return new Date(guess);
}

function addDays(date: string, amount: number): string {
  const { year, month, day } = dateParts(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return shifted.toISOString().slice(0, 10);
}

export function todayInZone(timeZone: string): string {
  const local = partsInZone(new Date(), timeZone);
  return `${local.year.toString().padStart(4, "0")}-${local.month.toString().padStart(2, "0")}-${local.day.toString().padStart(2, "0")}`;
}

function validDate(date: string): boolean {
  const normalized = addDays(date, 0);
  return normalized === date && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

export function sessionDayRange(date: string, env: WorkerEnv): { start: string; end: string } {
  return {
    start: zoneDateToUtc(date, env.APP_TZ).toISOString(),
    end: zoneDateToUtc(addDays(date, 1), env.APP_TZ).toISOString(),
  };
}

export const todayRoute = new Hono<AppEnv>().get("/", async (c) => {
  const { profile } = currentAuth(c);
  if (profile.role !== "teacher") throw forbidden();
  const query = parseInput(todayQuerySchema, c.req.query());
  const date = query.date ?? todayInZone(c.env.APP_TZ);
  if (!validDate(date)) throw validation({ date: "Invalid calendar date" });
  const range = sessionDayRange(date, c.env);
  const supabase = createRequestClient(c);
  const { data, error } = await supabase
    .from("sessions")
    .select("id,starts_at,ends_at,status,classes!inner(name,courses!inner(subject,level)),session_students(student_id,is_new)")
    .eq("teacher_id", profile.id)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as TodayRow[];
  const response: TodayResponse = {
    date,
    sessions: rows.map((row) => ({
      id: row.id,
      class_name: row.classes?.name ?? "",
      subject: row.classes?.courses?.subject ?? "",
      level: row.classes?.courses?.level ?? "",
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      student_count: row.session_students.length,
      status: row.status,
      new_count: row.session_students.filter((student) => student.is_new).length,
    })),
  };
  return c.json(response);
});
