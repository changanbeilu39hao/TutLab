import {
  impersonateRequestSchema,
  type ImpersonationResponse,
  type TeacherTarget,
} from "@tutlab/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useImpersonationTargets } from "../lib/queries";
import { Modal } from "./Modal";

function ImpersonationBanner() {
  const { impersonation, endImpersonation } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const endMutation = useMutation({
    mutationFn: endImpersonation,
    onSuccess: () => navigate("/concerns", { replace: true }),
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!impersonation) return null;
  const minutes = Math.max(
    0,
    Math.ceil((Date.parse(impersonation.expiresAt) - now) / 60_000),
  );
  return (
    <div className="impersonation-notice" role="status">
      <div className="row-between impersonation-row">
        <span className="badge badge-warning">
          正在以 {impersonation.teacher.display_name} 的视角查看（剩余 {minutes} 分钟）
        </span>
        <button
          className="btn"
          type="button"
          onClick={() => endMutation.mutate()}
          disabled={endMutation.isPending}
        >
          {endMutation.isPending ? "返回中…" : "返回我的账号"}
        </button>
      </div>
      {endMutation.error instanceof Error ? (
        <p className="page-desc" role="alert">
          {endMutation.error instanceof ApiError ? `${endMutation.error.code} · ` : ""}
          {endMutation.error.message}
        </p>
      ) : null}
    </div>
  );
}

function ImpersonationControl() {
  const { profile, impersonation, request, startImpersonation } = useAuth();
  const navigate = useNavigate();
  const [pendingTeacher, setPendingTeacher] = useState<TeacherTarget | null>(null);
  const enabled = !impersonation && profile?.role !== "teacher";
  const targetsQuery = useImpersonationTargets(enabled);
  const startMutation = useMutation({
    mutationFn: (teacher: TeacherTarget) =>
      request<ImpersonationResponse>("/api/impersonate", {
        method: "POST",
        body: impersonateRequestSchema.parse({ teacher_id: teacher.id }),
      }),
    onSuccess: (response) => {
      startImpersonation(response);
      setPendingTeacher(null);
      navigate("/today", { replace: true });
    },
  });

  if (!enabled && !impersonation) return null;
  return (
    <>
      <select
        className="select impersonation-select"
        aria-label="以老师视角查看"
        value=""
        disabled={Boolean(impersonation) || targetsQuery.isPending || startMutation.isPending}
        onChange={(event) => {
          const teacher = targetsQuery.data?.teachers.find(
            (item) => item.id === event.target.value,
          );
          if (teacher) {
            startMutation.reset();
            setPendingTeacher(teacher);
          }
        }}
      >
        <option value="">
          {impersonation
            ? "模拟中"
            : targetsQuery.isPending
              ? "加载老师…"
              : "以老师视角查看"}
        </option>
        {(targetsQuery.data?.teachers ?? []).map((teacher) => (
          <option value={teacher.id} key={teacher.id}>
            {teacher.display_name} · {teacher.campus}
          </option>
        ))}
      </select>
      {pendingTeacher ? (
        <Modal
          title="确认切换老师视角"
          description={`将以 ${pendingTeacher.display_name} 的视角查看，所有操作会被记录为 ${pendingTeacher.display_name} 执行。`}
          confirmLabel="确认切换"
          pending={startMutation.isPending}
          onCancel={() => setPendingTeacher(null)}
          onConfirm={() => startMutation.mutate(pendingTeacher)}
        >
          {startMutation.error instanceof Error ? (
            <p className="form-error" role="alert">
              {startMutation.error instanceof ApiError
                ? `${startMutation.error.code} · `
                : ""}
              {startMutation.error.message}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

export function AppShell() {
  const { profile, notice, clearNotice, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return localStorage.getItem("tutlab.theme") === "dark" ? "dark" : "light";
  });
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("tutlab.theme", theme);
  }, [theme]);

  const isTeacher = profile?.role === "teacher";
  const pageName = location.pathname.startsWith("/session/")
    ? "课次详情"
    : isTeacher
      ? "今天"
      : "需关注";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">tutlab</div>
        <div className="nav-section">工作台</div>
        {isTeacher ? (
          <NavLink
            to="/today"
            className={() =>
              `nav-item${location.pathname === "/today" || location.pathname.startsWith("/session/") ? " active" : ""}`
            }
          >
            今天
          </NavLink>
        ) : (
          <NavLink
            to="/concerns"
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            需关注
          </NavLink>
        )}
        <div className="sidebar-footer">
          <span className="avatar">{profile?.display_name.slice(0, 1) ?? "·"}</span>
          <span>
            {profile?.display_name}
            <span className="text-3"> · {profile?.campus}</span>
          </span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            tutlab / <b>{pageName}</b>
          </div>
          <div className="topbar-actions">
            <ImpersonationControl />
            <button
              className="btn btn-ghost theme-toggle"
              type="button"
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
              aria-label={theme === "light" ? "切换到深色主题" : "切换到浅色主题"}
            >
              {theme === "light" ? "深色" : "浅色"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={loggingOut}
              onClick={() => {
                setLoggingOut(true);
                void logout()
                  .then(() => navigate("/login", { replace: true }))
                  .finally(() => setLoggingOut(false));
              }}
            >
              退出
            </button>
          </div>
        </header>
        <ImpersonationBanner />
        {notice ? (
          <div className="card row-between notice" role="alert">
            <span>{notice}</span>
            <button className="btn btn-sm" type="button" onClick={clearNotice}>
              知道了
            </button>
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
