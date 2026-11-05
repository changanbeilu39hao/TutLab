import {
  endImpersonationRequestSchema,
  type ImpersonationResponse,
  type Profile,
  type TeacherTarget,
} from "@tutlab/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiRequest, ApiError, type ApiRequestOptions } from "./api";
import { supabase } from "./supabase";

const IMPERSONATION_STORAGE_KEY = "tutlab.impersonation.v1";

interface ImpersonationSession {
  token: string;
  expiresAt: string;
  teacher: TeacherTarget;
  jti: string;
}

export type AuthenticatedRequest = <T>(
  path: string,
  options?: Omit<ApiRequestOptions, "token"> & { token?: string },
) => Promise<T>;

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  activeToken: string | null;
  initializing: boolean;
  profileLoading: boolean;
  profileError: unknown;
  impersonation: ImpersonationSession | null;
  notice: string | null;
  request: AuthenticatedRequest;
  retryProfile: () => void;
  login: (email: string, password: string) => Promise<Profile>;
  logout: () => Promise<void>;
  startImpersonation: (response: ImpersonationResponse) => void;
  endImpersonation: () => Promise<void>;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isTeacherTarget(value: unknown): value is TeacherTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "display_name" in value &&
    typeof value.display_name === "string" &&
    "campus" in value &&
    typeof value.campus === "string"
  );
}

function readTokenJti(token: string): string {
  const encoded = token.split(".")[1];
  if (!encoded) {
    throw new Error("模拟令牌格式无效。");
  }
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const payload: unknown = JSON.parse(atob(normalized));
  if (typeof payload !== "object" || payload === null || !("jti" in payload)) {
    throw new Error("模拟令牌缺少 jti。");
  }
  return endImpersonationRequestSchema.parse({ jti: payload.jti }).jti;
}

function readStoredImpersonation(): ImpersonationSession | null {
  const stored = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (
      typeof value !== "object" ||
      value === null ||
      !("token" in value) ||
      typeof value.token !== "string" ||
      !("expiresAt" in value) ||
      typeof value.expiresAt !== "string" ||
      !("teacher" in value) ||
      !isTeacherTarget(value.teacher) ||
      !("jti" in value) ||
      typeof value.jti !== "string" ||
      Date.parse(value.expiresAt) <= Date.now()
    ) {
      sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
      return null;
    }
    endImpersonationRequestSchema.parse({ jti: value.jti });
    return {
      token: value.token,
      expiresAt: value.expiresAt,
      teacher: value.teacher,
      jti: value.jti,
    };
  } catch {
    sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [impersonation, setImpersonation] = useState<ImpersonationSession | null>(
    readStoredImpersonation,
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setInitializing(false);
    });
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const activeToken = impersonation?.token ?? session?.access_token ?? null;
  const profileKey = impersonation?.jti ?? session?.user.id ?? "anonymous";

  const expireImpersonation = useCallback(
    (message: string) => {
      sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
      setImpersonation(null);
      queryClient.clear();
      setNotice(message);
    },
    [queryClient],
  );

  const request = useCallback<AuthenticatedRequest>(
    async <T,>(
      path: string,
      options?: Omit<ApiRequestOptions, "token"> & { token?: string },
    ): Promise<T> => {
      const token = options?.token ?? activeToken;
      if (!token) {
        throw new ApiError("UNAUTHORIZED", "请先登录。", 401);
      }
      try {
        return await apiRequest<T>(path, {
          token,
          ...(options?.method ? { method: options.method } : {}),
          ...(options && "body" in options ? { body: options.body } : {}),
        });
      } catch (error) {
        if (
          impersonation &&
          token === impersonation.token &&
          error instanceof ApiError &&
          error.status === 401
        ) {
          expireImpersonation("模拟令牌已失效，已自动返回你的账号。");
        }
        throw error;
      }
    },
    [activeToken, expireImpersonation, impersonation],
  );

  const meQuery = useQuery({
    queryKey: ["me", profileKey],
    enabled: Boolean(activeToken),
    queryFn: () => request<Profile>("/api/me"),
    retry: false,
  });

  useEffect(() => {
    if (!impersonation && meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      void supabase.auth.signOut({ scope: "local" });
    }
  }, [impersonation, meQuery.error]);

  useEffect(() => {
    if (!impersonation) return;
    const checkExpiry = () => {
      if (Date.parse(impersonation.expiresAt) <= Date.now()) {
        expireImpersonation("模拟令牌已过期，已自动返回你的账号。");
      }
    };
    checkExpiry();
    const timer = window.setInterval(checkExpiry, 1000);
    return () => window.clearInterval(timer);
  }, [expireImpersonation, impersonation]);

  const login = useCallback(
    async (email: string, password: string): Promise<Profile> => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const profile = await apiRequest<Profile>("/api/me", {
        token: data.session.access_token,
      });
      queryClient.setQueryData(["me", data.user.id], profile);
      return profile;
    },
    [queryClient],
  );

  const startImpersonation = useCallback(
    (response: ImpersonationResponse) => {
      const next: ImpersonationSession = {
        token: response.token,
        expiresAt: response.expires_at,
        teacher: response.teacher,
        jti: readTokenJti(response.token),
      };
      sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(next));
      setImpersonation(next);
      setNotice(null);
      queryClient.clear();
    },
    [queryClient],
  );

  const endImpersonation = useCallback(async () => {
    if (!impersonation) return;
    try {
      await apiRequest("/api/impersonate/end", {
        method: "POST",
        token: impersonation.token,
        body: endImpersonationRequestSchema.parse({ jti: impersonation.jti }),
      });
      sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
      setImpersonation(null);
      queryClient.clear();
      setNotice("已返回你的账号。");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        expireImpersonation("模拟令牌已失效，已自动返回你的账号。");
        return;
      }
      throw error;
    }
  }, [expireImpersonation, impersonation, queryClient]);

  const logout = useCallback(async () => {
    if (impersonation) {
      await endImpersonation().catch(() => undefined);
    }
    await supabase.auth.signOut();
    sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    setImpersonation(null);
    queryClient.clear();
  }, [endImpersonation, impersonation, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile: meQuery.data ?? null,
      activeToken,
      initializing,
      profileLoading: Boolean(activeToken) && meQuery.isPending,
      profileError: meQuery.error,
      impersonation,
      notice,
      request,
      retryProfile: () => void meQuery.refetch(),
      login,
      logout,
      startImpersonation,
      endImpersonation,
      clearNotice: () => setNotice(null),
    }),
    [
      activeToken,
      endImpersonation,
      impersonation,
      initializing,
      login,
      logout,
      meQuery.data,
      meQuery.error,
      meQuery.isPending,
      meQuery.refetch,
      notice,
      request,
      session,
      startImpersonation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return context;
}
