import { feedbackOutputSchema, type FeedbackOutput } from "@tutlab/shared";
import { ApiError } from "../lib/errors";
import type { LlmRosterStudent } from "../lib/llm";

const forbiddenCommercialTerms = /价格|折扣|优惠|退款|保分|提分|保证|承诺/;

function resolveStudent(reference: string, roster: LlmRosterStudent[]): LlmRosterStudent | undefined {
  const exactId = roster.find((student) => student.student_id === reference);
  if (exactId) return exactId;
  const exactName = roster.find((student) => student.name === reference);
  if (exactName) return exactName;
  const normalized = reference.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  return roster.find((student) => {
    const name = student.name.toLocaleLowerCase();
    return name.includes(normalized) || normalized.includes(name);
  });
}

export function sanitizeFeedback(
  input: FeedbackOutput,
  roster: LlmRosterStudent[],
  preserveStates = false,
): { output: FeedbackOutput; unmatched: string[] } {
  const unmatched: string[] = [];
  const seen = new Set<string>();
  const resolve = (reference: string): LlmRosterStudent | undefined => {
    const student = resolveStudent(reference, roster);
    if (!student) unmatched.push(reference);
    return student;
  };

  const perStudent: FeedbackOutput["per_student"] = [];
  for (const item of input.per_student) {
    if (seen.size >= roster.length) break;
    const student = resolve(item.student_id);
    if (!student || seen.has(student.student_id)) continue;
    seen.add(student.student_id);
    perStudent.push({ ...item, student_id: student.student_id });
  }

  const parentMessages: FeedbackOutput["parent_messages"] = [];
  const parentSeen = new Set<string>();
  for (const item of input.parent_messages) {
    if (parentMessages.length >= roster.length) break;
    const student = resolve(item.student_id);
    if (!student || parentSeen.has(student.student_id)) continue;
    parentSeen.add(student.student_id);
    const fallback = `请家长与孩子一起回顾本次课堂内容，并完成老师布置的练习。${student.name}的课堂观察已记录在学情反馈中。`;
    parentMessages.push({
      student_id: student.student_id,
      body: forbiddenCommercialTerms.test(item.body) ? fallback : item.body,
      state: preserveStates ? item.state ?? "draft" : "draft",
    });
  }

  const concerns: FeedbackOutput["concerns"] = [];
  const concernSeen = new Set<string>();
  for (const item of input.concerns) {
    if (concerns.length >= roster.length) break;
    const student = resolve(item.student_id);
    if (!student || concernSeen.has(student.student_id)) continue;
    concernSeen.add(student.student_id);
    concerns.push({ ...item, student_id: student.student_id });
  }

  return {
    output: {
      covered: input.covered,
      per_student: perStudent,
      homework: input.homework,
      class_note: input.class_note,
      parent_messages: parentMessages,
      concerns,
    },
    unmatched: [...new Set(unmatched)],
  };
}

export function parseLlmFeedback(input: unknown): FeedbackOutput {
  const parsed = feedbackOutputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("SCHEMA_INVALID", 422, undefined, {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export function requireMatchedStudents(unmatched: string[]): void {
  if (unmatched.length > 0) {
    throw new ApiError("NOT_IN_ROSTER", 422, undefined, { unmatched });
  }
}
