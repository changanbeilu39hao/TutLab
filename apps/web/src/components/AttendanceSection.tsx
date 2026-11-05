import {
  attendanceKindSchema,
  attendanceRequestSchema,
  type AttendanceKind,
  type AttendanceRequest,
  type AttendanceResponse,
  type RosterStudent,
} from "@tutlab/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

const attendanceLabels: Record<AttendanceKind, string> = {
  present: "出席",
  absent: "缺席",
  leave: "请假",
  trial: "试听",
};

const attendanceOrder: AttendanceKind[] = ["present", "absent", "leave", "trial"];

type Selections = Record<string, AttendanceKind | undefined>;

function readStoredSelections(sessionId: string, roster: RosterStudent[]): Selections {
  let stored: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`tutlab.attendance.${sessionId}`) ?? "{}");
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      stored = value as Record<string, unknown>;
    }
  } catch {
    stored = {};
  }
  return Object.fromEntries(roster.map((student) => {
    const saved = attendanceKindSchema.safeParse(stored[student.student_id]);
    return [
      student.student_id,
      saved.success ? saved.data : student.attendance?.status ?? (student.is_trial ? "trial" : undefined),
    ];
  }));
}

export function AttendanceSection({
  sessionId,
  roster,
}: {
  sessionId: string;
  roster: RosterStudent[];
}) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const [selections, setSelections] = useState<Selections>(() => readStoredSelections(sessionId, roster));
  const [saved, setSaved] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setSelections((current) => Object.fromEntries(roster.map((student) => [
      student.student_id,
      current[student.student_id] ?? student.attendance?.status ?? (student.is_trial ? "trial" : undefined),
    ])));
  }, [roster]);

  useEffect(() => {
    localStorage.setItem(`tutlab.attendance.${sessionId}`, JSON.stringify(selections));
  }, [selections, sessionId]);

  const attendanceMutation = useMutation({
    mutationFn: (items: AttendanceRequest["items"]) =>
      request<AttendanceResponse>(`/api/sessions/${sessionId}/attendance`, {
        method: "PUT",
        body: attendanceRequestSchema.parse({ items }),
      }),
    onSuccess: () => {
      setSaved(true);
      setValidationError(null);
      void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
    },
  });

  const selectedItems = roster.flatMap((student) => {
    const status = selections[student.student_id];
    return status ? [{ student_id: student.student_id, status }] : [];
  });
  const deductedCount = selectedItems.filter(
    (item) => item.status === "present" || item.status === "absent",
  ).length;
  const trialCount = selectedItems.filter((item) => item.status === "trial").length;

  const submit = () => {
    const blocked = roster.some(
      (student) =>
        student.balance < 1 &&
        (student.attendance?.deducted ?? 0) === 0 &&
        selections[student.student_id] === "present",
    );
    if (blocked) {
      setValidationError("有余额不足的学生不能出席，请改为请假或联系 admin。 ");
      return;
    }
    setSaved(false);
    setValidationError(null);
    attendanceMutation.mutate(selectedItems);
  };

  return (
    <section className="card attendance-section" aria-labelledby="attendance-title">
      <h2 className="card-title" id="attendance-title">① 点名</h2>
      <div className="roster-list">
        {roster.map((student) => {
          const selected = selections[student.student_id];
          const alreadyDeducted = (student.attendance?.deducted ?? 0) > 0;
          const insufficient = student.balance < 1 && !alreadyDeducted;
          const willDeduct = selected === "present" || selected === "absent";
          return (
            <div className="roster-row" key={student.student_id}>
              <div className="student-identity">
                <div className="row">
                  <strong>{student.name}</strong>
                  {student.is_new ? <span className="badge badge-warning">新</span> : null}
                  {student.is_trial ? <span className="badge">试听生</span> : null}
                  {insufficient ? <span className="badge badge-danger">余额不足</span> : null}
                </div>
                <div className={`balance${insufficient ? " badge badge-danger" : ""}`}>
                  余额 {student.balance}
                  {willDeduct && !alreadyDeducted ? ` → ${student.balance - 1}` : ""}
                </div>
                {insufficient ? (
                  <div className="row insufficient-actions">
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() =>
                        setSelections((current) => ({
                          ...current,
                          [student.student_id]: "leave",
                        }))
                      }
                    >
                      改为请假
                    </button>
                    <span className="text-2">如需充值，请联系 admin</span>
                  </div>
                ) : null}
              </div>
              <div className="attendance-actions" aria-label={`${student.name}考勤状态`}>
                {attendanceOrder.map((status) => (
                  <button
                    className={`btn btn-sm${selected === status ? " btn-primary" : ""}`}
                    type="button"
                    key={status}
                    aria-pressed={selected === status}
                    disabled={status === "present" && insufficient}
                    title={status === "present" && insufficient ? "余额不足，请改为请假或联系 admin" : undefined}
                    onClick={() => {
                      setSaved(false);
                      setSelections((current) => ({
                        ...current,
                        [student.student_id]: status,
                      }));
                    }}
                  >
                    {attendanceLabels[status]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="attendance-confirm">
        <div>
          <h2 className="card-title">② 确认扣课时</h2>
          <p className="page-desc">
            当前出席/缺席 {deductedCount} 人（各扣 1 课时），试听 {trialCount} 人不扣；请假不扣。实际结果以 API 返回为准。
          </p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={selectedItems.length === 0 || attendanceMutation.isPending}
          onClick={submit}
        >
          {attendanceMutation.isPending ? "提交中…" : "确认考勤"}
        </button>
      </div>
      {validationError ? <p className="form-error" role="alert">VALIDATION_FAILED · {validationError}</p> : null}
      {attendanceMutation.error ? (
        <p className="form-error" role="alert">
          {attendanceMutation.error instanceof ApiError ? `${attendanceMutation.error.code} · ` : ""}
          {attendanceMutation.error instanceof Error
            ? attendanceMutation.error.message
            : "考勤提交失败，请重试。"}
        </p>
      ) : null}
      {saved ? <p className="badge badge-success" role="status">考勤已确认，名单余额已按 API 结果更新。</p> : null}
    </section>
  );
}
