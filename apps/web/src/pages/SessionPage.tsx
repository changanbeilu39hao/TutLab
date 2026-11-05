import { Link, useNavigate, useParams } from "react-router-dom";
import { AttendanceSection } from "../components/AttendanceSection";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/DataState";
import { FeedbackSection } from "../components/FeedbackSection";
import { formatSessionDate } from "../lib/date";
import { useSession } from "../lib/queries";

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sessionQuery = useSession(id);
  const data = sessionQuery.data;

  return (
    <>
      <div className="mb-12">
        <Link className="btn btn-ghost" to="/today">← 返回今天</Link>
      </div>
      {sessionQuery.isPending ? <LoadingSkeleton rows={4} /> : null}
      {sessionQuery.isError ? (
        <ErrorState error={sessionQuery.error} retry={() => void sessionQuery.refetch()} />
      ) : null}
      {data ? (
        <>
          <h1 className="page-title">
            {data.session.level} {data.session.subject} · {data.session.class_name}
          </h1>
          <p className="page-desc">
            {formatSessionDate(data.session.starts_at)} · {data.roster.length} 人
          </p>
          {data.roster.length === 0 ? (
            <EmptyState
              title="这节课还没有学生"
              description="请先联系 admin 核对本课次名单，名单确认后再回来点名。"
              actionLabel="返回今天"
              onAction={() => navigate("/today")}
            />
          ) : (
            <div className="session-workflow">
              <AttendanceSection sessionId={data.session.id} roster={data.roster} />
              <FeedbackSection
                sessionId={data.session.id}
                roster={data.roster}
                feedback={data.feedback}
              />
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
