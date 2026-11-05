import { useEffect, type ReactNode } from "react";

export function Modal({
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, pending]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 className="modal-title" id="modal-title">
          {title}
        </h2>
        <p className="modal-desc">{description}</p>
        {children}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onCancel} disabled={pending}>
            取消
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={onConfirm}
            disabled={pending}
            autoFocus
          >
            {pending ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
