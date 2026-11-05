import type { ApiErrorBody } from "@tutlab/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  token: string;
  body?: unknown;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const error = value.error;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export async function apiRequest<T>(
  path: string,
  { method = "GET", token, body }: ApiRequestOptions,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "网络连接失败，请检查连接后重试。", 0);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiError(payload.error.code, payload.error.message, response.status);
    }
    throw new ApiError(
      response.status === 401 ? "UNAUTHORIZED" : "REQUEST_FAILED",
      `请求失败（HTTP ${response.status}）。`,
      response.status,
    );
  }
  return payload as T;
}
