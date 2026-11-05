import type { ScheduleKind } from "@tutlab/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/DataState";
import { ScheduleModal } from "../components/ScheduleModal";
import { useAuth } from "../lib/auth";
import {
  formatDate,
  formatTime,
  melbourneDate,
  melbourneToday,
  shiftDate,
  startOfWeek,
} from "../lib/date";
import { useSchedule } from "../lib/queries";

export function SchedulePage() {
  const { profile } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(melbourneToday()));
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind | null>(null);
  const weekEnd = shiftDate(weekStart, 6);
  const queryEnd = shiftDate(weekStart, 7);
  const scheduleQuery = useSchedule(weekStart, queryEnd);
  const sessions = scheduleQuery.data?.sessions ?? [];
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const canManage = profile?.role === "admin" || profile?.role === "manager";

  return (
    <>
      <div className="page-heading-row">
        <div>
          <h1 className="page-title">排课日历</h1>
          <p className="page-desc">共享查看全部课次，按 Melbourne 时间展示。</p>
        </div>
        {canManage ? (
          <div className="row schedule-actions">
            <button className="btn" type="button" onClick={() => setScheduleKind("trial")}>
              安排试听
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => setScheduleKind("course")}
            >
              安排课程
            </button>
          </div>
        ) : null}
      </div>
      <div className="row-between schedule-weekbar">
        <strong>
          {formatDate(weekStart)} – {formatDate(weekEnd)}
        </strong>
        <div className="row date-actions">
          <button className="btn" type="button" onClick={() => setWeekStart(shiftDate(weekStart, -7))}>
            ← 上一周
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setWeekStart(startOfWeek(melbourneToday()))}
          >
            本周
          </button>
          <button className="btn" type="button" onClick={() => setWeekStart(shiftDate(weekStart, 7))}>
            下一周 →
          </button>
        </div>
      </div>
      {scheduleQuery.isPending ? <LoadingSkeleton rows={4} /> : null}
      {scheduleQuery.isError ? (
        <ErrorState error={scheduleQuery.error} retry={() => void scheduleQuery.refetch()} />
      ) : null}
      {scheduleQuery.data && sessions.length === 0 ? (
        <EmptyState
          title="这一周没有课次"
          description={
            canManage
              ? "可以查看下一周，或使用上方按钮安排新的试听或课程。"
              : "可以查看下一周的共享课次安排。"
          }
          actionLabel="查看下一周"
          onAction={() => setWeekStart(shiftDate(weekStart, 7))}
        />
      ) : null}
      {scheduleQuery.data ? (
        <div className="schedule-grid">
          {days.map((day) => {
            const daySessions = sessions
              .filter((session) => melbourneDate(session.starts_at) === day)
              .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
            return (
              <section className="card schedule-day" key={day}>
                <div className="row-between schedule-day-heading">
                  <h2 className={`card-title${day === melbourneToday() ? " schedule-today" : ""}`}>
                    {formatDate(day)}
                  </h2>
                </div>
                <div className="schedule-day-sessions">
                  {daySessions.map((session) => {
                    const ownTeacherSession =
                      profile?.role === "teacher" && profile.id === session.teacher_id;
                    return (
                      <article
                        className={`schedule-session${ownTeacherSession ? " schedule-own-session" : ""}${session.status === "done" ? " schedule-completed-session" : ""}`}
                        key={session.id}
                      >
                        <div className="schedule-session-time">
                          {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
                        </div>
                        <h3 className="schedule-session-title">
                          {session.level} {session.subject} · {session.class_name}
                        </h3>
                        <div className="schedule-session-meta">
                          <span>{session.teacher_name}</span>
                          <span>{session.campus}</span>
                          <span>{session.student_count} 人</span>
                        </div>
                        {session.status === "cancelled" || ownTeacherSession ? (
                          <div className="row schedule-session-footer">
                            {session.status === "cancelled" ? (
                              <span className="badge badge-danger">已取消</span>
                            ) : null}
                            {ownTeacherSession ? (
                              <Link
                                className="btn btn-sm schedule-session-open"
                                to={`/session/${session.id}`}
                                aria-label={`进入 ${session.class_name} 课次`}
                              >
                                进入课次
                              </Link>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {daySessions.length === 0 ? <p className="schedule-empty-day">无课</p> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
      {scheduleKind ? (
        <ScheduleModal
          kind={scheduleKind}
          from={weekStart}
          to={queryEnd}
          onClose={() => setScheduleKind(null)}
        />
      ) : null}
    </>
  );
}
