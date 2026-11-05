import type { z } from "zod";
import type {
  attendanceKindSchema,
  concernLevelSchema,
  FeedbackOutput,
  feedbackOutputSchema,
  masterySchema,
  parentMessageStateSchema,
  rawStatusSchema,
  roleSchema,
  sessionStatusSchema,
} from "./schemas";

export type Role = z.infer<typeof roleSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type AttendanceKind = z.infer<typeof attendanceKindSchema>;
export type Mastery = z.infer<typeof masterySchema>;
export type ConcernLevel = z.infer<typeof concernLevelSchema>;
export type RawStatus = z.infer<typeof rawStatusSchema>;
export type ParentMessageState = z.infer<typeof parentMessageStateSchema>;
export type { FeedbackOutput };

export interface Profile {
  id: string;
  role: Role;
  display_name: string;
  campus: string;
}

export interface TodaySession {
  id: string;
  class_name: string;
  subject: string;
  level: string;
  starts_at: string;
  ends_at: string;
  student_count: number;
  status: SessionStatus;
  new_count: number;
}

export interface TodayResponse {
  date: string;
  sessions: TodaySession[];
}

export interface AttendanceView {
  status: AttendanceKind;
  deducted: number;
}

export interface RosterStudent {
  student_id: string;
  name: string;
  is_new: boolean;
  is_trial: boolean;
  balance: number;
  attendance: AttendanceView | null;
}

export interface SessionSummary {
  id: string;
  class_name: string;
  subject: string;
  level: string;
  starts_at: string;
  ends_at: string;
  status: SessionStatus;
}

export interface SessionFeedback {
  raw_id: string;
  raw_text: string;
  status: RawStatus;
  items: FeedbackOutput | null;
}

export interface SessionResponse {
  session: SessionSummary;
  roster: RosterStudent[];
  feedback: SessionFeedback | null;
}

export interface AttendanceResult {
  student_id: string;
  deducted: number;
  balance_after: number;
}

export interface AttendanceResponse {
  results: AttendanceResult[];
}

export interface CreateFeedbackResponse {
  raw_id: string;
  status: RawStatus;
  parsed: FeedbackOutput | null;
  unmatched: string[];
}

export interface ConcernItem {
  id: string;
  student_name: string;
  level: ConcernLevel;
  reason: string;
  class_name: string;
  owner: string;
}

export interface ConcernsResponse {
  items: ConcernItem[];
}

export interface TeacherTarget {
  id: string;
  display_name: string;
  campus: string;
}

export interface ImpersonationTargetsResponse {
  teachers: TeacherTarget[];
}

export interface ImpersonationResponse {
  token: string;
  expires_at: string;
  teacher: TeacherTarget;
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN_NOT_OWNER"
  | "NESTED_IMPERSONATION"
  | "NOT_FOUND"
  | "NOT_IN_ROSTER"
  | "INSUFFICIENT_CREDITS"
  | "SESSION_LOCKED"
  | "VALIDATION_FAILED"
  | "LLM_UNAVAILABLE"
  | "SCHEMA_INVALID";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
}

export type FeedbackSchema = typeof feedbackOutputSchema;
