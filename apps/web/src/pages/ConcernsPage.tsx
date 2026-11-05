import { resolveConcernRequestSchema } from "@tutlab/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/DataState";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useConcerns } from "../lib/queries";

export function ConcernsPage() {
  const concernsQuery = useConcerns();
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const resolveMutation = useMutation({
    mutationFn: (id: string) =>
      request<{ ok: true }>(`/api/concerns/${id}`, {
        method: "PATCH",
        body: resolveConcernRequestSchema.parse({ resolved: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["concerns"] }),
  });
  const items = concernsQuery.data?.items ?? [];

  return (
    <>
      <h1 className="page-title">需关注 · {items.length} 人</h1>
      <p className="page-desc">优先处理风险学生，联系后再标记为已处理。</p>
      {concernsQuery.isPending ? <LoadingSkeleton /> : null}
      {concernsQuery.isError ? (
        <ErrorState error={concernsQuery.error} retry={() => void concernsQuery.refetch()} />
      ) : null}
      {concernsQuery.data && items.length === 0 ? (
        <EmptyState
          title="当前没有待处理关注"
          description="新的课堂风险会出现在这里。现在可以刷新确认最新状态。"
          actionLabel="刷新列表"
          onAction={() => void concernsQuery.refetch()}
        />
      ) : null}
      {resolveMutation.error ? (
        <div className="form-error" role="alert">
          {resolveMutation.error instanceof ApiError ? `${resolveMutation.error.code} · ` : ""}
          {resolveMutation.error instanceof Error
            ? resolveMutation.error.message
            : "处理失败，请重试。"}
        </div>
      ) : null}
      <div className="concern-list">
        {items.map((concern) => (
          <article className="card concern-card" key={concern.id}>
            <div className="concern-main">
              <span className={`badge ${concern.level === "risk" ? "badge-danger" : "badge-warning"}`}>
                {concern.level === "risk" ? "风险" : "关注"}
              </span>
              <div>
                <h2 className="card-title">{concern.student_name}</h2>
                <p className="concern-reason">{concern.reason}</p>
                <p className="page-desc">{concern.class_name} · 学管 {concern.owner}</p>
              </div>
            </div>
            {!concern.dynamic ? (
              <button
                className="btn"
                type="button"
                disabled={resolveMutation.isPending}
                onClick={() => {
                  resolveMutation.reset();
                  resolveMutation.mutate(concern.id);
                }}
              >
                {resolveMutation.isPending && resolveMutation.variables === concern.id
                  ? "处理中…"
                  : "已处理"}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}
