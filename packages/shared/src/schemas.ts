import { z } from "zod";

export const roleSchema = z.enum(["admin", "teacher", "manager"]);
export const studentStatusSchema = z.enum(["active", "paused", "churned"]);
export const sessionStatusSchema = z.enum(["planned", "done", "cancelled"]);
export const attendanceKindSchema = z.enum(["present", "absent", "leave", "trial"]);
export const masterySchema = z.enum(["none", "partial", "solid", "unknown"]);
export const concernLevelSchema = z.enum(["watch", "risk"]);
export const rawStatusSchema = z.enum(["parsed", "fallback", "failed"]);
export const feedbackFlagSchema = z.enum([
  "注意力",
  "计算粗心",
  "基础薄弱",
  "进度超前",
  "情绪",
  "缺勤",
]);
export const parentMessageStateSchema = z.enum(["draft", "sent"]);

export const feedbackOutputSchema = z.object({
  covered: z.array(z.string().trim().min(1).max(120)).min(1).max(5),
  per_student: z.array(z.object({
    student_id: z.string().min(1),
    mastery: masterySchema,
    observation: z.string().trim().min(1).max(120),
    flags: z.array(feedbackFlagSchema).max(3),
  }).strict()),
  homework: z.string().trim().min(1).max(1000).nullable(),
  class_note: z.string().trim().min(1).max(1000).nullable(),
  parent_messages: z.array(z.object({
    student_id: z.string().min(1),
    body: z.string().trim().min(1).max(1000),
    state: parentMessageStateSchema.optional(),
  }).strict()),
  concerns: z.array(z.object({
    student_id: z.string().min(1),
    level: concernLevelSchema,
    reason: z.string().trim().min(1).max(240),
  }).strict()),
}).strict();

export const attendanceItemSchema = z.object({
  student_id: z.string().uuid(),
  status: attendanceKindSchema,
  remark: z.string().trim().max(500).optional(),
}).strict();

export const attendanceRequestSchema = z.object({
  items: z.array(attendanceItemSchema).min(1).max(100),
}).strict();

export const createFeedbackRequestSchema = z.object({
  raw_text: z.string().trim().min(1).max(10000),
}).strict();

export const updateFeedbackRequestSchema = z.object({
  raw_id: z.string().uuid(),
  edited: feedbackOutputSchema,
}).strict();

export const resolveConcernRequestSchema = z.object({
  resolved: z.literal(true),
}).strict();

export const impersonateRequestSchema = z.object({
  teacher_id: z.string().uuid(),
}).strict();

export const endImpersonationRequestSchema = z.object({
  jti: z.string().uuid(),
}).strict();

export const todayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type FeedbackOutput = z.infer<typeof feedbackOutputSchema>;
export type AttendanceRequest = z.infer<typeof attendanceRequestSchema>;
export type CreateFeedbackRequest = z.infer<typeof createFeedbackRequestSchema>;
export type UpdateFeedbackRequest = z.infer<typeof updateFeedbackRequestSchema>;
