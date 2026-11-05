import { ApiError } from "../lib/api";

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-label="正在加载" aria-busy="true">
      <div className="skeleton skeleton-heading" />
      {Array.from({ length: rows }, (_, index) => (
        <div className="card skeleton-card" key={index}>
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line skeleton-line-short" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const code = error instanceof ApiError ? error.code : "REQUEST_FAILED";
  const message = error instanceof Error ? error.message : "请求失败，请重试。";
  return (
    <div className="card stack" role="alert">
      <div className="row">
        <span className="badge badge-danger">{code}</span>
        <strong>加载失败</strong>
      </div>
      <p className="page-desc">{message}</p>
      <div>
        <button className="btn btn-primary" type="button" onClick={retry}>
          重试
        </button>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="card stack">
      <h2 className="card-title">{title}</h2>
      <p className="page-desc">{description}</p>
      <div>
        <button className="btn" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
