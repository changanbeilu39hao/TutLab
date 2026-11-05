const APP_TIME_ZONE = "Australia/Melbourne";

type DatePart = "year" | "month" | "day" | "hour" | "minute";

function partValue(parts: Intl.DateTimeFormatPart[], type: DatePart): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) throw new Error("无法读取 Melbourne 时间。");
  return Number(value);
}

function zonedParts(date: Date): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
}

function melbourneDateKey(date: Date): string {
  const parts = zonedParts(date);
  const year = partValue(parts, "year").toString().padStart(4, "0");
  const month = partValue(parts, "month").toString().padStart(2, "0");
  const day = partValue(parts, "day").toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function melbourneOffset(date: Date): number {
  const parts = zonedParts(date);
  const localAsUTC = Date.UTC(
    partValue(parts, "year"),
    partValue(parts, "month") - 1,
    partValue(parts, "day"),
    partValue(parts, "hour"),
    partValue(parts, "minute"),
  );
  return localAsUTC - date.getTime();
}

export function melbourneToday(): string {
  return melbourneDateKey(new Date());
}

export function melbourneDate(value: string): string {
  return melbourneDateKey(new Date(value));
}

export function startOfWeek(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  return shiftDate(date, -daysSinceMonday);
}

export function melbourneDateTimeToISO(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("请输入有效的开始和结束时间。");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const localAsUTC = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(localAsUTC)) throw new Error("请输入有效的开始和结束时间。");

  let timestamp = localAsUTC;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    timestamp = localAsUTC - melbourneOffset(new Date(timestamp));
  }

  const result = new Date(timestamp);
  const parts = zonedParts(result);
  const matchesInput =
    partValue(parts, "year") === year &&
    partValue(parts, "month") === month &&
    partValue(parts, "day") === day &&
    partValue(parts, "hour") === hour &&
    partValue(parts, "minute") === minute;
  if (!matchesInput) {
    throw new Error("所选时间在 Melbourne 夏令时切换中不存在，请选择其他时间。");
  }
  return result.toISOString();
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: APP_TIME_ZONE,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function formatSessionDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: APP_TIME_ZONE,
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
