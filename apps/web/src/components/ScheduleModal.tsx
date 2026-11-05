import {
  scheduleRequestSchema,
  type ScheduleKind,
  type ScheduleRequest,
} from "@tutlab/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { melbourneDateTimeToISO, melbourneToday, shiftDate } from "../lib/date";
import { useSchedule, useStudents } from "../lib/queries";
import { ErrorState, LoadingSkeleton } from "./DataState";
import { Modal } from "./Modal";

interface ScheduleModalProps {
  kind: ScheduleKind;
  from: string;
  to: string;
  initialStudentId?: string;
  onClose: () => void;
}

export function ScheduleModal({
  kind: initialKind,
  from,
  to,
  initialStudentId,
  onClose,
}: ScheduleModalProps) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const studentsQuery = useStudents();
  const scheduleQuery = useSchedule(from, to);
  const [kind, setKind] = useState<ScheduleKind>(initialKind);
  const [studentId, setStudentId] = useState(initialStudentId ?? "");
  const [classId, setClassId] = useState("");
  const [startsAt, setStartsAt] = useState(
    () => `${shiftDate(melbourneToday(), 1)}T17:00`,
  );
  const [endsAt, setEndsAt] = useState(
    () => `${shiftDate(melbourneToday(), 1)}T18:30`,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: ScheduleRequest) =>
      request<{ session_id: string }>("/api/schedule", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["schedule"] });
      void queryClient.invalidateQueries({ queryKey: ["students"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      onClose();
    },
  });

  const students = studentsQuery.data?.items ?? [];
  const classes = scheduleQuery.data?.classes ?? [];
  const dependencyPending = studentsQuery.isPending || scheduleQuery.isPending;
  const dependencyError = studentsQuery.isError
    ? studentsQuery.error
    : scheduleQuery.isError
      ? scheduleQuery.error
      : null;

  const clearFeedback = () => {
    setValidationError(null);
    mutation.reset();
  };

  const submit = () => {
    clearFeedback();
    if (kind === "trial" && !studentId) {
      setValidationError("安排试听时必须选择学生。");
      return;
    }
    if (!classId) {
      setValidationError("请选择班级。");
      return;
    }

    try {
      const startsAtISO = melbourneDateTimeToISO(startsAt);
      const endsAtISO = melbourneDateTimeToISO(endsAt);
      if (Date.parse(endsAtISO) <= Date.parse(startsAtISO)) {
        setValidationError("结束时间必须晚于开始时间。");
        return;
      }
      const result = scheduleRequestSchema.safeParse({
        kind,
        class_id: classId,
        ...(studentId ? { student_id: studentId } : {}),
        starts_at: startsAtISO,
        ends_at: endsAtISO,
      });
      if (!result.success) {
        setValidationError("请检查学生、班级和开始/结束时间。");
        return;
      }
      mutation.mutate(result.data);
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "请输入有效的开始和结束时间。",
      );
    }
  };

  return (
    <Modal
      title={kind === "trial" ? "安排试听" : "安排课程"}
      description="按 Australia/Melbourne 本地时间排课；课程不选学生即为全班安排。"
      confirmLabel={kind === "trial" ? "确认安排试听" : "确认安排课程"}
      pending={mutation.isPending}
      confirmDisabled={
        dependencyPending ||
        Boolean(dependencyError) ||
        classes.length === 0 ||
        (kind === "trial" && students.length === 0)
      }
      onCancel={onClose}
      onConfirm={submit}
    >
      {dependencyPending ? <LoadingSkeleton rows={2} /> : null}
      {dependencyError ? (
        <ErrorState
          error={dependencyError}
          retry={() => {
            if (studentsQuery.isError) void studentsQuery.refetch();
            if (scheduleQuery.isError) void scheduleQuery.refetch();
          }}
        />
      ) : null}
      {!dependencyPending && !dependencyError ? (
        <>
          <label className="field">
            <span className="field-label">类型</span>
            <select
              className="select"
              value={kind}
              disabled={mutation.isPending}
              onChange={(event) => {
                setKind(event.target.value as ScheduleKind);
                clearFeedback();
              }}
            >
              <option value="trial">试听</option>
              <option value="course">课程</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">
              {kind === "trial" ? "学生（必选）" : "学生（可选全班）"}
            </span>
            <select
              className="select"
              value={studentId}
              disabled={mutation.isPending}
              onChange={(event) => {
                setStudentId(event.target.value);
                clearFeedback();
              }}
            >
              <option value="">
                {kind === "trial" ? "请选择学生" : "全班（不指定学生）"}
              </option>
              {students.map((student) => (
                <option value={student.id} key={student.id}>
                  {student.name} · {student.year_level} 年级
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">班级</span>
            <select
              className="select"
              value={classId}
              disabled={mutation.isPending}
              onChange={(event) => {
                setClassId(event.target.value);
                clearFeedback();
              }}
            >
              <option value="">请选择班级</option>
              {classes.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.level} {item.subject} · {item.teacher_name}
                </option>
              ))}
            </select>
          </label>
          {classes.length === 0 ? (
            <p className="page-desc">暂无可用班级，请先确认班级数据后再排课。</p>
          ) : null}
          <label className="field">
            <span className="field-label">开始时间（Melbourne）</span>
            <input
              className="input"
              type="datetime-local"
              value={startsAt}
              required
              disabled={mutation.isPending}
              onChange={(event) => {
                setStartsAt(event.target.value);
                clearFeedback();
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">结束时间（Melbourne）</span>
            <input
              className="input"
              type="datetime-local"
              value={endsAt}
              required
              disabled={mutation.isPending}
              onChange={(event) => {
                setEndsAt(event.target.value);
                clearFeedback();
              }}
            />
          </label>
        </>
      ) : null}
      {validationError ? (
        <div className="form-error" role="alert">
          VALIDATION_FAILED · {validationError}
        </div>
      ) : null}
      {mutation.error ? (
        <div className="form-error" role="alert">
          {mutation.error instanceof ApiError
            ? `${mutation.error.code} · ${mutation.error.message}`
            : "REQUEST_FAILED · 排课失败，请重试。"}
        </div>
      ) : null}
    </Modal>
  );
}
