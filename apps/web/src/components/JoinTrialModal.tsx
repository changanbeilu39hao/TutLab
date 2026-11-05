import { addTrialRequestSchema, type ScheduleSession } from "@tutlab/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatSessionDate } from "../lib/date";
import { useStudents } from "../lib/queries";
import { ErrorState, LoadingSkeleton } from "./DataState";
import { Modal } from "./Modal";

interface JoinTrialRequest {
  student_id: string;
}

interface JoinTrialModalProps {
  session: ScheduleSession;
  onClose: () => void;
}

export function JoinTrialModal({ session, onClose }: JoinTrialModalProps) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const studentsQuery = useStudents();
  const [studentId, setStudentId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: JoinTrialRequest) =>
      request<{ session_id: string }>(`/api/sessions/${session.id}/trial`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["schedule"] });
      void queryClient.invalidateQueries({ queryKey: ["students"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      onClose();
    },
  });

  const students = studentsQuery.data?.items ?? [];

  const clearFeedback = () => {
    setValidationError(null);
    mutation.reset();
  };

  const submit = () => {
    clearFeedback();
    const result = addTrialRequestSchema.safeParse({ student_id: studentId });
    if (!result.success) {
      setValidationError("请选择学生。");
      return;
    }
    mutation.mutate(result.data);
  };

  return (
    <Modal
      title="加入试听"
      description="将学生作为试听加入当前已有课次，不修改课程时间。"
      confirmLabel="确认加入试听"
      pending={mutation.isPending}
      confirmDisabled={
        studentsQuery.isPending || studentsQuery.isError || students.length === 0
      }
      onCancel={onClose}
      onConfirm={submit}
    >
      <label className="field">
        <span className="field-label">课程</span>
        <input
          className="input"
          value={`${session.level} ${session.subject} · ${session.class_name}`}
          readOnly
        />
      </label>
      <label className="field">
        <span className="field-label">教师</span>
        <input className="input" value={session.teacher_name} readOnly />
      </label>
      <label className="field">
        <span className="field-label">开始时间（Melbourne）</span>
        <input className="input" value={formatSessionDate(session.starts_at)} readOnly />
      </label>
      <label className="field">
        <span className="field-label">结束时间（Melbourne）</span>
        <input className="input" value={formatSessionDate(session.ends_at)} readOnly />
      </label>
      {studentsQuery.isPending ? <LoadingSkeleton rows={1} /> : null}
      {studentsQuery.isError ? (
        <ErrorState
          error={studentsQuery.error}
          retry={() => void studentsQuery.refetch()}
        />
      ) : null}
      {!studentsQuery.isPending && !studentsQuery.isError ? (
        <label className="field">
          <span className="field-label">学生（必选）</span>
          <select
            className="select"
            value={studentId}
            required
            disabled={mutation.isPending}
            onChange={(event) => {
              setStudentId(event.target.value);
              clearFeedback();
            }}
          >
            <option value="">请选择学生</option>
            {students.map((student) => (
              <option value={student.id} key={student.id}>
                {student.name} · {student.year_level} 年级
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {studentsQuery.data && students.length === 0 ? (
        <p className="page-desc">暂无可加入的学生，请先确认学生名单。</p>
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
            : "REQUEST_FAILED · 加入试听失败，请重试。"}
        </div>
      ) : null}
    </Modal>
  );
}
