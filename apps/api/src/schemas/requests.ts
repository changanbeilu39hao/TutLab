import { z, type ZodType } from "zod";
import { validation } from "../lib/errors";

export const idParamSchema = z.string().uuid();

export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw validation({
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export async function parseJson<T>(schema: ZodType<T>, request: Request): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validation();
  }
  return parseInput(schema, body);
}
