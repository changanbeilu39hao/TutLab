import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { LoadingSkeleton, ErrorState } from "../components/DataState";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { homeForRole } from "../lib/navigation";

export function LoginPage() {
  const {
    session,
    profile,
    initializing,
    profileLoading,
    profileError,
    retryProfile,
    login,
  } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (profile) return <Navigate to={homeForRole(profile.role)} replace />;
  if (initializing || (session && profileLoading)) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <LoadingSkeleton rows={1} />
        </div>
      </main>
    );
  }
  if (session && profileError) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <ErrorState error={profileError} retry={retryProfile} />
        </div>
      </main>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    void login(email, password)
      .then((nextProfile) => navigate(homeForRole(nextProfile.role), { replace: true }))
      .catch((reason: unknown) => setError(reason))
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-brand">tutlab</div>
        <p className="login-sub">课后考勤与反馈</p>
        {error ? (
          <div className="form-error" role="alert">
            {error instanceof ApiError ? `${error.code} · ` : "UNAUTHORIZED · "}
            {error instanceof Error ? error.message : "登录失败，请重试。"}
          </div>
        ) : null}
        <form onSubmit={submit}>
          <label className="field">
            <span className="field-label">邮箱</span>
            <input
              className="input"
              type="email"
              aria-label="邮箱"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@tutlab.local"
            />
          </label>
          <label className="field">
            <span className="field-label">密码</span>
            <input
              className="input"
              type="password"
              aria-label="密码"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="btn btn-primary login-submit" type="submit" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </main>
  );
}
