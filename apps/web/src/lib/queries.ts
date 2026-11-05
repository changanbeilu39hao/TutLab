import {
  scheduleQuerySchema,
  todayQuerySchema,
  type ConcernsResponse,
  type ImpersonationTargetsResponse,
  type ScheduleResponse,
  type SessionResponse,
  type StudentsResponse,
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

export function useStudents() {
  const { request, impersonation } = useAuth();
  return useQuery({
    queryKey: ["students", impersonation?.jti ?? "self"],
    queryFn: () => request<StudentsResponse>("/api/students"),
    retry: retryRequest,
  });
}

export function useSchedule(from: string, to: string) {
  const { request, impersonation } = useAuth();
  return useQuery({
    queryKey: ["schedule", from, to, impersonation?.jti ?? "self"],
    queryFn: () => {
      const query = scheduleQuerySchema.parse({ from, to });
      return request<ScheduleResponse>(
        `/api/schedule?from=${encodeURIComponent(query.from)}&to=${encodeURIComponent(query.to)}`,
      );
    },
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
