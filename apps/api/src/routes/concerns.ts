import {
  resolveConcernRequestSchema,
  type ConcernItem,
  type ConcernLevel,
  type ConcernsResponse,
} from "@tutlab/shared";
import { Hono } from "hono";
import { createRequestClient, currentAuth, type AppEnv } from "../lib/auth";
import { forbidden, notFound } from "../lib/errors";
import { idParamSchema, parseInput, parseJson } from "../schemas/requests";
import { todayInZone } from "./today";

interface ConcernRow {
  id: string;
  student_id: string;
  level: ConcernLevel;
  reason: string;
  students: {
    name: string;
    owner: { display_name: string } | null;
  } | null;
  sessions: { classes: { name: string } | null } | null;
}

interface ActiveStudentRow {
  id: string;
  name: string;
  owner: { display_name: string } | null;
}

interface EnrollmentRow {
  student_id: string;
  start_date: string;
  end_date: string | null;
  classes: { name: string } | null;
}

interface ConcernGroup {
  id: string;
  student_name: string;
  level: ConcernLevel;
  reasons: string[];
  class_name: string;
  owner: string;
  dynamic: boolean;
}

function requireConcernRole(role: string): void {
  if (role !== "admin" && role !== "manager") throw forbidden();
}

export const concernsRoute = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { profile } = currentAuth(c);
    requireConcernRole(profile.role);
    const supabase = createRequestClient(c);

    let concernQuery = supabase
      .from("concerns")
      .select("id,student_id,level,reason,students!inner(name,owner:profiles!students_service_owner_id_fkey(display_name)),sessions(classes(name))")
      .is("resolved_at", null)
      .eq("students.status", "active")
      .order("created_at", { ascending: false });
    let studentQuery = supabase
      .from("students")
      .select("id,name,owner:profiles!students_service_owner_id_fkey(display_name)")
      .eq("status", "active")
      .order("name");
    if (profile.role === "admin") {
      concernQuery = concernQuery.eq("students.service_owner_id", profile.id);
      studentQuery = studentQuery.eq("service_owner_id", profile.id);
    }

    const [concernResult, studentResult] = await Promise.all([concernQuery, studentQuery]);
    if (concernResult.error) throw new Error(concernResult.error.message);
    if (studentResult.error) throw new Error(studentResult.error.message);
    const concernRows = (concernResult.data ?? []) as unknown as ConcernRow[];
    const studentRows = (studentResult.data ?? []) as unknown as ActiveStudentRow[];

    const balances = new Map<string, number>();
    const classNames = new Map<string, string[]>();
    if (studentRows.length > 0) {
      const studentIds = studentRows.map((student) => student.id);
      const [ledgerResult, enrollmentResult] = await Promise.all([
        supabase
          .from("credit_ledger")
          .select("student_id,balance_after,created_at,id")
          .in("student_id", studentIds)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
        supabase
          .from("enrollments")
          .select("student_id,start_date,end_date,classes(name)")
          .in("student_id", studentIds)
          .eq("status", "active"),
      ]);
      if (ledgerResult.error) throw new Error(ledgerResult.error.message);
      if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);

      for (const row of (ledgerResult.data ?? []) as { student_id: string; balance_after: number }[]) {
        if (!balances.has(row.student_id)) balances.set(row.student_id, row.balance_after);
      }

      const today = todayInZone(c.env.APP_TZ);
      for (const row of (enrollmentResult.data ?? []) as unknown as EnrollmentRow[]) {
        if (row.start_date > today || (row.end_date !== null && row.end_date < today)) continue;
        const className = row.classes?.name;
        if (!className) continue;
        const names = classNames.get(row.student_id) ?? [];
        if (!names.includes(className)) names.push(className);
        classNames.set(row.student_id, names);
      }
    }

    const groups = new Map<string, ConcernGroup>();
    for (const row of concernRows) {
      const existing = groups.get(row.student_id);
      if (existing) {
        existing.reasons.push(row.reason);
        if (row.level === "risk") existing.level = "risk";
        continue;
      }
      groups.set(row.student_id, {
        id: row.id,
        student_name: row.students?.name ?? "",
        level: row.level,
        reasons: [row.reason],
        class_name: row.sessions?.classes?.name ?? "",
        owner: row.students?.owner?.display_name ?? "",
        dynamic: false,
      });
    }

    for (const student of studentRows) {
      const balance = balances.get(student.id) ?? 0;
      if (balance < 0 || balance > 3) continue;
      const level: ConcernLevel = balance === 0 ? "risk" : "watch";
      const reason = balance === 0 ? "课时已用完，需要立即续费" : `余额 ${balance} 课时，建议续费`;
      const className = classNames.get(student.id)?.join("、") || "未分班";
      const existing = groups.get(student.id);
      if (existing) {
        existing.reasons.push(reason);
        if (level === "risk") existing.level = "risk";
        if (!existing.class_name) existing.class_name = className;
        continue;
      }
      groups.set(student.id, {
        id: `balance:${student.id}`,
        student_name: student.name,
        level,
        reasons: [reason],
        class_name: className,
        owner: student.owner?.display_name ?? "",
        dynamic: true,
      });
    }

    const items: ConcernItem[] = Array.from(groups.values(), (group) => ({
      id: group.id,
      student_name: group.student_name,
      level: group.level,
      reason: group.reasons.join("；"),
      class_name: group.class_name,
      owner: group.owner,
      dynamic: group.dynamic,
    }));
    items.sort((left, right) => Number(right.level === "risk") - Number(left.level === "risk"));
    const response: ConcernsResponse = { items };
    return c.json(response);
  })
  .patch("/:id", async (c) => {
    const { profile } = currentAuth(c);
    requireConcernRole(profile.role);
    if (c.req.param("id").startsWith("balance:")) throw notFound();
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
