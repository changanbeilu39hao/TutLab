import type { SessionStatus } from "@tutlab/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/DataState";
import { formatDate, formatTime, melbourneToday, shiftDate } from "../lib/date";
import { useToday } from "../lib/queries";

const statusText: Record<SessionStatus, string> = {
  planned: "待上课",
  done: "已完成",
  cancelled: "已取消",
};

export function TodayPage() {
  const [date, setDate] = useState(melbourneToday);
  const todayQuery = useToday(date);

  return (
    <>
      <div className="page-heading-row">
        <div>
          <h1 className="page-title">{date === melbourneToday() ? "今天" : "课表"} · {formatDate(date)}</h1>
          <p className="page-desc">接下来的课次、人数与新生，一眼看清。</p>
        </div>
        <div className="row date-actions">
          <button className="btn" type="button" onClick={() => setDate(shiftDate(date, -1))}>
            ← 前一天
          </button>
          <button className="btn" type="button" onClick={() => setDate(melbourneToday())}>
            今天
          </button>
          <button className="btn" type="button" onClick={() => setDate(shiftDate(date, 1))}>
            后一天 →
          </button>
        </div>
      </div>
      {todayQuery.isPending ? <LoadingSkeleton /> : null}
      {todayQuery.isError ? (
        <ErrorState error={todayQuery.error} retry={() => void todayQuery.refetch()} />
      ) : null}
      {todayQuery.data?.sessions.length === 0 ? (
        <EmptyState
          title="这一天没有课"
          description="可以查看后一天的安排，或返回今天继续处理课后反馈。"
          actionLabel="查看后一天"
          onAction={() => setDate(shiftDate(date, 1))}
        />
      ) : null}
      <div className="session-list">
        {todayQuery.data?.sessions.map((session) => (
          <article className="card session-card" key={session.id}>
            <div className="session-card-main">
              <div className="session-time">{formatTime(session.starts_at)}–{formatTime(session.ends_at)}</div>
              <div className="session-info">
                <h2 className="card-title">{session.level} {session.subject} · {session.class_name}</h2>
                <div className="row card-meta">
                  <span>{session.student_count} 人</span>
                  {session.new_count > 0 ? (
                    <span className="badge badge-warning">{session.new_count} 位新生</span>
                  ) : null}
                  <span
                    className={`badge${session.status === "done" ? " badge-success" : session.status === "cancelled" ? " badge-danger" : ""}`}
                  >
                    {statusText[session.status]}
                  </span>
                </div>
              </div>
              <Link className="btn btn-primary session-open" to={`/session/${session.id}`}>
                开始
              </Link>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
