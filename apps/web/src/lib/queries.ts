import {
  todayQuerySchema,
  type ConcernsResponse,
  type ImpersonationTargetsResponse,
  type SessionResponse,
  type TodayResponse,
} from "@tutlab/shared";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "./api";
import { useAuth } from "./auth";

function retryRequest(failureCount: number, error: Error): boolean {
  return !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
    failureCount < 1;
}

export function useToday(date: string) {
  const { request, impersonation } = useAuth();
  return useQuery({
    queryKey: ["today", date, impersonation?.jti ?? "self"],
    queryFn: () => {
      const query = todayQuerySchema.parse({ date });
      return request<TodayResponse>(`/api/today?date=${encodeURIComponent(query.date ?? "")}`);
    },
    retry: retryRequest,
  });
}

export function useSession(sessionId: string | undefined) {
  const { request, impersonation } = useAuth();
  return useQuery({
    queryKey: ["session", sessionId, impersonation?.jti ?? "self"],
    enabled: Boolean(sessionId),
    queryFn: () => request<SessionResponse>(`/api/sessions/${sessionId ?? ""}`),
    retry: retryRequest,
  });
}

export function useConcerns() {
  const { request, impersonation } = useAuth();
  return useQuery({
    queryKey: ["concerns", impersonation?.jti ?? "self"],
    queryFn: () => request<ConcernsResponse>("/api/concerns"),
    retry: retryRequest,
  });
}

export function useImpersonationTargets(enabled: boolean) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ["impersonation-targets"],
    enabled,
    queryFn: () => request<ImpersonationTargetsResponse>("/api/impersonate/targets"),
    retry: false,
  });
}
