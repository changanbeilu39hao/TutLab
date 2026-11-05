import type { ApiErrorBody, ApiErrorCode } from "@tutlab/shared";

export type ErrorStatus = 401 | 403 | 404 | 422 | 423 | 500;

const messages: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: "登录状态无效或已过期",
  FORBIDDEN_NOT_OWNER: "无权访问该资源",
  NESTED_IMPERSONATION: "模拟视角不能嵌套",
  NOT_FOUND: "资源不存在",
  NOT_IN_ROSTER: "学生不在本节课名单中",
  INSUFFICIENT_CREDITS: "余额不足",
  SESSION_LOCKED: "课次结束已超过 48 小时",
  VALIDATION_FAILED: "请求内容校验失败",
  LLM_UNAVAILABLE: "服务暂时不可用",
  SCHEMA_INVALID: "反馈结构校验失败",
};

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: ErrorStatus,
    message?: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message ?? messages[code]);
  }

  body(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export function unauthorized(message?: string): ApiError {
  return new ApiError("UNAUTHORIZED", 401, message);
}

export function forbidden(code: "FORBIDDEN_NOT_OWNER" | "NESTED_IMPERSONATION" = "FORBIDDEN_NOT_OWNER"): ApiError {
  return new ApiError(code, 403);
}

export function notFound(): ApiError {
  return new ApiError("NOT_FOUND", 404);
}

export function validation(details: Record<string, unknown> = {}): ApiError {
  return new ApiError("VALIDATION_FAILED", 422, undefined, details);
}
