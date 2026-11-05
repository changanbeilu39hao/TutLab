import type { Role } from "@tutlab/shared";
import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ErrorState, LoadingSkeleton } from "./components/DataState";
import { useAuth } from "./lib/auth";
import { homeForRole } from "./lib/navigation";
import { ConcernsPage } from "./pages/ConcernsPage";
import { LoginPage } from "./pages/LoginPage";
import { SessionPage } from "./pages/SessionPage";
import { TodayPage } from "./pages/TodayPage";

function ProtectedRoute() {
  const {
    session,
    activeToken,
    profile,
    initializing,
    profileLoading,
    profileError,
    retryProfile,
  } = useAuth();

  if (initializing || (activeToken && profileLoading)) {
    return (
      <main className="route-loading">
        <LoadingSkeleton />
      </main>
    );
  }
  if (!session && !activeToken) return <Navigate to="/login" replace />;
  if (profileError) {
    return (
      <main className="route-loading">
        <ErrorState error={profileError} retry={retryProfile} />
      </main>
    );
  }
  if (!profile) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RoleRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile) return null;
  if (!roles.includes(profile.role)) {
    return <Navigate to={homeForRole(profile.role)} replace />;
  }
  return children;
}

function DefaultRoute() {
  const { profile, initializing } = useAuth();
  if (initializing) return null;
  if (profile) return <Navigate to={homeForRole(profile.role)} replace />;
  return <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route
            path="/today"
            element={
              <RoleRoute roles={["teacher"]}>
                <TodayPage />
              </RoleRoute>
            }
          />
          <Route
            path="/session/:id"
            element={
              <RoleRoute roles={["teacher"]}>
                <SessionPage />
              </RoleRoute>
            }
          />
          <Route
            path="/concerns"
            element={
              <RoleRoute roles={["admin", "manager"]}>
                <ConcernsPage />
              </RoleRoute>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<DefaultRoute />} />
    </Routes>
  );
}
