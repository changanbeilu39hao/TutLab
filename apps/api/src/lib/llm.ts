import type { WorkerEnv } from "./auth";

export interface LlmRosterStudent {
  student_id: string;
  name: string;
}

export class LlmUnavailableError extends Error {}

function numberSetting(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function generateFeedback(
  env: WorkerEnv,
  rawText: string,
  roster: LlmRosterStudent[],
): Promise<unknown> {
  if (!env.DEEPSEEK_API_KEY) throw new LlmUnavailableError("Missing DeepSeek key");

  const rosterText = roster.map((student) => `${student.student_id}: ${student.name}`).join("\n");
  const prompt = `你是教培机构的课堂反馈整理助手。把老师的口语整理成严格 JSON。
只描述观察到的事实，不写“表现不错”这类评价。不要替机构承诺任何商业条款。
学生名必须原样来自名单，student_id 必须使用对应名单中的完整 ID。
covered 写 1 到 5 条知识点；per_student 的 observation 不超过 120 字，flags 最多 3 条。
flags 只能是：注意力、计算粗心、基础薄弱、进度超前、情绪、缺勤。
mastery 只能是 none、partial、solid、unknown。没有信息的字段使用 null 或空数组。
parent_messages 是给家长看的草稿，concerns 是给学管的风险信号。
concerns 的每一项必须严格使用 {"student_id":"名单中的ID","level":"watch 或 risk","reason":"关注原因"} 结构。
level 只能是 watch 或 risk，reason 必须是具体观察；不要使用 issue 等其他字段。
输出必须只包含 covered、per_student、homework、class_note、parent_messages、concerns 六个顶层字段，并保证 JSON 完整。

名单：
${rosterText}

示例（虚构学生，仅演示格式）：
老师原话：今天练了分数加法，虚构学生甲通分正确，最后两道计算写错。
输出：{"covered":["分数加法与通分"],"per_student":[{"student_id":"名单中的ID","mastery":"partial","observation":"通分步骤正确，最后两道练习出现计算错误。","flags":["计算粗心"]}],"homework":"完成分数加法练习","class_note":"下次先复习通分。","parent_messages":[{"student_id":"名单中的ID","body":"今天练习了分数加法。孩子能完成通分步骤，建议在家检查最后两道的计算过程。"}],"concerns":[{"student_id":"名单中的ID","level":"watch","reason":"最后两道练习出现计算错误，需要下次课复习通分。"}]}

老师原话：
${rawText}`;

  let response: Response;
  try {
    response = await fetch(`${env.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: "你只输出符合要求的 JSON 对象。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: numberSetting(env.LLM_TEMPERATURE, 0.2),
        max_tokens: numberSetting(env.LLM_MAX_TOKENS, 2000),
      }),
      signal: AbortSignal.timeout(numberSetting(env.LLM_TIMEOUT_MS, 12000)),
    });
  } catch (error) {
    throw new LlmUnavailableError(error instanceof Error ? error.message : "Request failed");
  }

  if (!response.ok) throw new LlmUnavailableError(`DeepSeek returned ${response.status}`);

  try {
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !("choices" in payload)) {
      throw new Error("Missing choices");
    }
    const choices = payload.choices;
    if (!Array.isArray(choices)) throw new Error("Invalid choices");
    const first: unknown = choices[0];
    if (typeof first !== "object" || first === null || !("message" in first)) {
      throw new Error("Missing message");
    }
    const message = first.message;
    if (typeof message !== "object" || message === null || !("content" in message)) {
      throw new Error("Missing content");
    }
    if (typeof message.content !== "string") throw new Error("Invalid content");
    if (env.DEBUG_LLM === "true") console.warn("DeepSeek raw content", message.content);
    return JSON.parse(message.content) as unknown;
  } catch (error) {
    throw new LlmUnavailableError(error instanceof Error ? error.message : "Invalid JSON");
  }
}
