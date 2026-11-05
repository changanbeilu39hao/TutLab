import { type StudentListItem, type StudentsResponse, type StudentStatus } from "@tutlab/shared";
import { Hono } from "hono";
import { createRequestClient, currentAuth, type AppEnv } from "../lib/auth";
import { forbidden } from "../lib/errors";

interface StudentRow {
  id: string;
  name: string;
  year_level: number;
  status: StudentStatus;
  enrollments: { classes: { name: string } | null }[];
}

export const studentsRoute = new Hono<AppEnv>().get("/", async (c) => {
  const { profile } = currentAuth(c);
  if (profile.role !== "admin" && profile.role !== "manager") throw forbidden();

  const supabase = createRequestClient(c);
  let query = supabase
    .from("students")
    .select("id,name,year_level,status,enrollments(classes(name))")
    .eq("enrollments.status", "active")
    .order("name");
  if (profile.role === "admin") query = query.eq("service_owner_id", profile.id);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as StudentRow[];
  const balances = new Map<string, number>();

  if (rows.length > 0) {
    const { data: ledgerData, error: ledgerError } = await supabase
      .from("credit_ledger")
      .select("student_id,balance_after,created_at,id")
      .in("student_id", rows.map((row) => row.id))
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (ledgerError) throw new Error(ledgerError.message);
    for (const row of (ledgerData ?? []) as { student_id: string; balance_after: number }[]) {
      if (!balances.has(row.student_id)) balances.set(row.student_id, row.balance_after);
    }
  }

  const response: StudentsResponse = {
    items: rows.map((row): StudentListItem => ({
      id: row.id,
      name: row.name,
      year_level: row.year_level,
      status: row.status,
      balance: balances.get(row.id) ?? 0,
      class_names: row.enrollments.flatMap((enrollment) => enrollment.classes?.name ?? []),
    })),
  };
  return c.json(response);
});
