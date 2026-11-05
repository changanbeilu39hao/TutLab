import {
  concernLevelSchema,
  createFeedbackRequestSchema,
  feedbackFlagSchema,
  masterySchema,
  updateFeedbackRequestSchema,
  type CreateFeedbackResponse,
  type FeedbackOutput,
  type Mastery,
  type RawStatus,
  type RosterStudent,
  type SessionFeedback,
  type UpdateFeedbackRequest,
} from "@tutlab/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { copyText } from "../lib/clipboard";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Modal } from "./Modal";

interface EditorState {
  rawId: string;
  status: RawStatus;
  output: FeedbackOutput;
  unmatched: string[];
}

type StudentFeedback = FeedbackOutput["per_student"][number];

const masteryLabels: Record<Mastery, string> = {
  none: "未掌握",
  partial: "部分掌握",
  solid: "已掌握",
  unknown: "待观察",
};

function manualFeedback(roster: RosterStudent[]): FeedbackOutput {
  return {
    covered: [],
    per_student: roster.map((student) => ({
      student_id: student.student_id,
      mastery: "unknown",
      observation: "",
      flags: [],
    })),
    homework: null,
    class_note: null,
    parent_messages: [],
    concerns: [],
  };
}

function errorMessage(error: unknown): string {
  return `${error instanceof ApiError ? `${error.code} · ` : ""}${
    error instanceof Error ? error.message : "请求失败，请重试。"
  }`;
}

export function FeedbackSection({
  sessionId,
  roster,
  feedback,
}: {
  sessionId: string;
  roster: RosterStudent[];
  feedback: SessionFeedback | null;
}) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const [rawText, setRawText] = useState(feedback?.raw_text ?? "");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const feedbackRawId = feedback?.raw_id;

  useEffect(() => {
    setRawText(feedback?.raw_text ?? "");
    setEditor(
      feedback
        ? {
            rawId: feedback.raw_id,
            status: feedback.status,
            output: feedback.items ?? manualFeedback(roster),
            unmatched: [],
          }
        : null,
    );
    setValidationError(null);
    // A raw feedback id identifies one editor session; attendance refetches must not erase edits.
  }, [sessionId, feedbackRawId]);

  const invalidateFeedback = () => {
    void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["concerns"] });
  };

  const generateMutation = useMutation({
    mutationFn: (text: string) =>
      request<CreateFeedbackResponse>(`/api/sessions/${sessionId}/feedback`, {
        method: "POST",
        body: createFeedbackRequestSchema.parse({ raw_text: text }),
      }),
    onSuccess: (response) => {
      setEditor({
        rawId: response.raw_id,
        status: response.status,
        output: response.parsed ?? manualFeedback(roster),
        unmatched: response.unmatched,
      });
      setValidationError(null);
      invalidateFeedback();
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: UpdateFeedbackRequest) =>
      request<{ ok: true }>(`/api/sessions/${sessionId}/feedback`, {
        method: "PUT",
        body,
      }),
    onSuccess: (_response, body) => {
      setEditor((current) => (current ? { ...current, output: body.edited } : current));
      setValidationError(null);
      invalidateFeedback();
    },
  });

  const sendMutation = useMutation({
    mutationFn: (body: UpdateFeedbackRequest) =>
      request<{ ok: true }>(`/api/sessions/${sessionId}/feedback`, {
        method: "PUT",
        body,
      }),
    onSuccess: (_response, body) => {
      setEditor((current) => (current ? { ...current, output: body.edited } : current));
      setSendingId(null);
      setValidationError(null);
      invalidateFeedback();
    },
  });

  const updateOutput = (updater: (output: FeedbackOutput) => FeedbackOutput) => {
    setEditor((current) => (current ? { ...current, output: updater(current.output) } : current));
    setValidationError(null);
  };

  const updateStudent = (studentId: string, patch: Partial<StudentFeedback>) => {
    updateOutput((output) => {
      const existing = output.per_student.find((item) => item.student_id === studentId);
      const base: StudentFeedback = existing ?? {
        student_id: studentId,
        mastery: "unknown",
        observation: "",
        flags: [],
      };
      const next = { ...base, ...patch };
      return {
        ...output,
        per_student: existing
          ? output.per_student.map((item) => (item.student_id === studentId ? next : item))
          : [...output.per_student, next],
      };
    });
  };

  const updateParentMessage = (studentId: string, body: string) => {
    updateOutput((output) => {
      const existing = output.parent_messages.find((item) => item.student_id === studentId);
      if (!body) {
        return {
          ...output,
          parent_messages: output.parent_messages.filter(
            (item) => item.student_id !== studentId,
          ),
        };
      }
      const next = {
        student_id: studentId,
        body,
        state: existing?.state ?? ("draft" as const),
      };
      return {
        ...output,
        parent_messages: existing
          ? output.parent_messages.map((item) => (item.student_id === studentId ? next : item))
          : [...output.parent_messages, next],
      };
    });
  };

  const updateConcern = (studentId: string, level: "" | "watch" | "risk") => {
    updateOutput((output) => {
      const existing = output.concerns.find((item) => item.student_id === studentId);
      if (!level) {
        return {
          ...output,
          concerns: output.concerns.filter((item) => item.student_id !== studentId),
        };
      }
      const next = { student_id: studentId, level, reason: existing?.reason ?? "" };
      return {
        ...output,
        concerns: existing
          ? output.concerns.map((item) => (item.student_id === studentId ? next : item))
          : [...output.concerns, next],
      };
    });
  };

  const validate = (rawId: string, edited: FeedbackOutput): UpdateFeedbackRequest | null => {
    const result = updateFeedbackRequestSchema.safeParse({ raw_id: rawId, edited });
    if (!result.success) {
      const issue = result.error.issues[0];
      setValidationError(
        `请补全必填内容后再保存（${issue?.path.join(".") ?? "feedback"}：${issue?.message ?? "格式无效"}）。`,
      );
      return null;
    }
    return result.data;
  };

  const save = () => {
    if (!editor) return;
    const body = validate(editor.rawId, editor.output);
    if (body) saveMutation.mutate(body);
  };

  const confirmSend = () => {
    if (!editor || !sendingId) return;
    const edited: FeedbackOutput = {
      ...editor.output,
      parent_messages: editor.output.parent_messages.map((message) =>
        message.student_id === sendingId ? { ...message, state: "sent" } : message,
      ),
    };
    const body = validate(editor.rawId, edited);
    if (!body) {
      setSendingId(null);
      return;
    }
    sendMutation.mutate(body);
  };

  return (
    <section className="card feedback-section" aria-labelledby="feedback-title">
      <h2 className="card-title" id="feedback-title">③ 反馈</h2>
      <label className="field">
        <span className="field-label">粘贴课堂口述或笔记</span>
        <textarea
          className="textarea feedback-raw"
          value={rawText}
          maxLength={10000}
          onChange={(event) => setRawText(event.target.value)}
          placeholder="例如：今天讲了三角函数图像变换，小明周期计算错了三道……"
        />
      </label>
      <div className="row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={!rawText.trim() || generateMutation.isPending}
          onClick={() => generateMutation.mutate(rawText)}
        >
          {generateMutation.isPending ? "生成中…" : "生成结构化反馈"}
        </button>
        {editor?.status === "fallback" ? (
          <span className="badge badge-warning">AI 暂不可用，请手动填写后保存</span>
        ) : null}
      </div>
      {generateMutation.error ? (
        <p className="form-error" role="alert">{errorMessage(generateMutation.error)}</p>
      ) : null}
      {editor?.unmatched.length ? (
        <p className="form-error" role="alert">
          {editor.unmatched.length} 条学生记录未匹配：{editor.unmatched.join("、")}，请手动检查。
        </p>
      ) : null}

      {editor ? (
        <div className="feedback-editor">
          <div className="card feedback-summary">
            <h3 className="card-title">教学总结</h3>
            <div className="summary-grid">
              <label className="field">
                <span className="field-label">覆盖知识点（每行一条，1–5 条）</span>
                <textarea
                  className="textarea"
                  value={editor.output.covered.join("\n")}
                  onChange={(event) =>
                    updateOutput((output) => ({ ...output, covered: event.target.value.split("\n") }))
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">作业</span>
                <textarea
                  className="textarea"
                  value={editor.output.homework ?? ""}
                  onChange={(event) =>
                    updateOutput((output) => ({
                      ...output,
                      homework: event.target.value || null,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">课堂衔接备注</span>
                <textarea
                  className="textarea"
                  value={editor.output.class_note ?? ""}
                  onChange={(event) =>
                    updateOutput((output) => ({
                      ...output,
                      class_note: event.target.value || null,
                    }))
                  }
                />
              </label>
            </div>
          </div>

          {roster.map((student) => {
            const item = editor.output.per_student.find(
              (entry) => entry.student_id === student.student_id,
            );
            const message = editor.output.parent_messages.find(
              (entry) => entry.student_id === student.student_id,
            );
            const concern = editor.output.concerns.find(
              (entry) => entry.student_id === student.student_id,
            );
            return (
              <article className="student-feedback" key={student.student_id}>
                <h3 className="section-title">{student.name}</h3>
                <div className="feedback-grid">
                  <div className="card feedback-card">
                    <div className="row-between mb-12">
                      <h4 className="card-title">家长版</h4>
                      <span className={`badge${message?.state === "sent" ? " badge-success" : ""}`}>
                        {message?.state === "sent" ? "sent" : "draft"}
                      </span>
                    </div>
                    <label className="field">
                      <span className="field-label">家长消息</span>
                      <textarea
                        className="textarea feedback-message"
                        value={message?.body ?? ""}
                        onChange={(event) => updateParentMessage(student.student_id, event.target.value)}
                      />
                    </label>
                    <div className="row feedback-card-actions">
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={!message?.body}
                        onClick={() => {
                          if (!message) return;
                          setCopyError(null);
                          void copyText(message.body)
                            .then(() => setCopiedId(student.student_id))
                            .catch((error: unknown) =>
                              setCopyError(error instanceof Error ? error.message : "复制失败。"),
                            );
                        }}
                      >
                        {copiedId === student.student_id ? "已复制" : "复制"}
                      </button>
                      {message && message.state !== "sent" ? (
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => setSendingId(student.student_id)}
                        >
                          发送
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="card feedback-card">
                    <h4 className="card-title">学管版</h4>
                    <label className="field">
                      <span className="field-label">关注级别</span>
                      <select
                        className="select"
                        value={concern?.level ?? ""}
                        onChange={(event) =>
                          updateConcern(
                            student.student_id,
                            event.target.value as "" | "watch" | "risk",
                          )
                        }
                      >
                        <option value="">无需关注</option>
                        {concernLevelSchema.options.map((level) => (
                          <option value={level} key={level}>
                            {level === "risk" ? "风险" : "关注"}
                          </option>
                        ))}
                      </select>
                    </label>
                    {concern ? (
                      <label className="field">
                        <span className="field-label">关注原因</span>
                        <textarea
                          className="textarea"
                          value={concern.reason}
                          onChange={(event) => {
                            const reason = event.target.value;
                            updateOutput((output) => ({
                              ...output,
                              concerns: output.concerns.map((entry) =>
                                entry.student_id === student.student_id
                                  ? { ...entry, reason }
                                  : entry,
                              ),
                            }));
                          }}
                        />
                      </label>
                    ) : null}
                  </div>

                  <div className="card feedback-card">
                    <h4 className="card-title">教学版</h4>
                    <label className="field">
                      <span className="field-label">掌握程度</span>
                      <select
                        className="select"
                        value={item?.mastery ?? "unknown"}
                        onChange={(event) =>
                          updateStudent(student.student_id, {
                            mastery: event.target.value as Mastery,
                          })
                        }
                      >
                        {masterySchema.options.map((mastery) => (
                          <option value={mastery} key={mastery}>{masteryLabels[mastery]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">课堂标记</span>
                      <select
                        className="select"
                        value={item?.flags[0] ?? ""}
                        onChange={(event) =>
                          updateStudent(student.student_id, {
                            flags: event.target.value
                              ? [event.target.value as (typeof feedbackFlagSchema.options)[number]]
                              : [],
                          })
                        }
                      >
                        <option value="">无</option>
                        {feedbackFlagSchema.options.map((flag) => (
                          <option value={flag} key={flag}>{flag}</option>
                        ))}
                      </select>
                    </label>
                    {item && item.flags.length > 1 ? (
                      <p className="text-2">其他标记：{item.flags.slice(1).join("、")}</p>
                    ) : null}
                    <label className="field">
                      <span className="field-label">观察事实</span>
                      <textarea
                        className="textarea"
                        maxLength={120}
                        value={item?.observation ?? ""}
                        onChange={(event) =>
                          updateStudent(student.student_id, { observation: event.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              </article>
            );
          })}

          {validationError ? (
            <p className="form-error" role="alert">VALIDATION_FAILED · {validationError}</p>
          ) : null}
          {saveMutation.error ? (
            <p className="form-error" role="alert">{errorMessage(saveMutation.error)}</p>
          ) : null}
          {sendMutation.error ? (
            <p className="form-error" role="alert">{errorMessage(sendMutation.error)}</p>
          ) : null}
          {copyError ? <p className="form-error" role="alert">{copyError}</p> : null}
          <div className="feedback-save">
            <button
              className="btn btn-primary"
              type="button"
              disabled={saveMutation.isPending || sendMutation.isPending}
              onClick={save}
            >
              {saveMutation.isPending ? "保存中…" : "保存反馈"}
            </button>
            {saveMutation.isSuccess ? <span className="badge badge-success">已保存</span> : null}
          </div>
        </div>
      ) : null}

      {sendingId ? (
        <Modal
          title="确认发送家长消息"
          description="请确认已复制并人工发送。确认后仅会将此消息的 state 改为 sent，不会调用外部发送服务。"
          confirmLabel="确认发送"
          pending={sendMutation.isPending}
          onCancel={() => setSendingId(null)}
          onConfirm={confirmSend}
        >
          {sendMutation.error ? (
            <p className="form-error" role="alert">{errorMessage(sendMutation.error)}</p>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}
