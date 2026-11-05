import type { ScheduleKind, StudentStatus } from "@tutlab/shared";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/DataState";
import { ScheduleModal } from "../components/ScheduleModal";
import { melbourneToday, startOfWeek, shiftDate } from "../lib/date";
import { useStudents } from "../lib/queries";

const statusText: Record<StudentStatus, string> = {
  active: "在读",
  paused: "暂停",
  churned: "流失",
};

interface StudentScheduleAction {
  kind: ScheduleKind;
  studentId: string;
}

export function StudentsPage() {
  const studentsQuery = useStudents();
  const [scheduleAction, setScheduleAction] = useState<StudentScheduleAction | null>(null);
  const students = studentsQuery.data?.items ?? [];
  const currentWeekStart = startOfWeek(melbourneToday());

  return (
    <>
      <h1 className="page-title">学生 · {students.length} 人</h1>
      <p className="page-desc">查看学生状态与课时余额，并直接安排试听或课程。</p>
      {studentsQuery.isPending ? <LoadingSkeleton rows={4} /> : null}
      {studentsQuery.isError ? (
        <ErrorState error={studentsQuery.error} retry={() => void studentsQuery.refetch()} />
      ) : null}
      {studentsQuery.data && students.length === 0 ? (
        <EmptyState
          title="暂无学生"
          description="当前没有可安排的学生，可以刷新确认最新名单。"
          actionLabel="刷新名单"
          onAction={() => void studentsQuery.refetch()}
        />
      ) : null}
      {students.length > 0 ? (
        <div className="table-wrap">
          <table className="table students-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>年级</th>
                <th>状态</th>
                <th>课时余额</th>
                <th>班级</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td data-label="姓名">{student.name}</td>
                  <td data-label="年级">{student.year_level} 年级</td>
                  <td data-label="状态">
                    <span
                      className={`badge${student.status === "active" ? " badge-success" : student.status === "paused" ? " badge-warning" : " badge-danger"}`}
                    >
                      {statusText[student.status]}
                    </span>
                  </td>
                  <td data-label="课时余额">{student.balance} 课时</td>
                  <td data-label="班级">{student.class_names.join("、") || "未分班"}</td>
                  <td data-label="操作">
                    <div className="student-actions">
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() =>
                          setScheduleAction({ kind: "trial", studentId: student.id })
                        }
                      >
                        安排试听
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() =>
                          setScheduleAction({ kind: "course", studentId: student.id })
                        }
                      >
                        安排课程
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {scheduleAction ? (
        <ScheduleModal
          kind={scheduleAction.kind}
          initialStudentId={scheduleAction.studentId}
          from={currentWeekStart}
          to={shiftDate(currentWeekStart, 7)}
          onClose={() => setScheduleAction(null)}
        />
      ) : null}
    </>
  );
}
