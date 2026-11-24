import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import type { Meter, Usage, UsageDetail } from "./types.js";

export const weekMs = 7 * 24 * 60 * 60 * 1000;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Accepts an ISO date, epoch seconds or epoch milliseconds. */
function asEpochMs(value: unknown): number | null {
  if (typeof value === "string") {
    const numeric = asNumber(value);
    if (numeric === null) {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    value = numeric;
  }
  const number = asNumber(value);
  if (number === null || number <= 0) {
    return null;
  }
  // Anything below 1e11 is too small to be milliseconds since 1973, so it is seconds.
  return number < 1e11 ? number * 1000 : number;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

const fiveHoursMs = 5 * 60 * 60 * 1000;

/** Label for a Claude limit scoped to one model or surface, such as "Fable". */
function scopeName(scope: unknown): string | null {
  const record = asRecord(scope);
  for (const key of ["model", "surface"]) {
    const name = asRecord(record?.[key])?.display_name;
    if (typeof name === "string" && name !== "") {
      return name;
    }
  }
  return null;
}

/**
 * Reads Claude's `GET /api/oauth/usage` answer: the all-models weekly limit for the menu bar, plus
 * the same extra limits Claude Code's /usage shows (the 5-hour session and per-model weekly limits).
 * Returns null when the answer has no weekly limit (for example on Enterprise plans).
 */
export function parseClaudeUsage(body: unknown): Usage | null {
  const root = asRecord(body);
  if (root === null) {
    return null;
  }
  const limits = (Array.isArray(root.limits) ? root.limits : [])
    .map(asRecord)
    .filter((limit): limit is Json => limit !== null);

  let used: number | null = null;
  let end: number | null = null;

  const sevenDay = asRecord(root.seven_day);
  if (sevenDay !== null) {
    used = asNumber(sevenDay.utilization);
    end = asEpochMs(sevenDay.resets_at);
  }

  if (used === null || end === null) {
    const weekly = limits.find((limit) => limit.kind === "weekly_all");
    if (weekly) {
      used ??= asNumber(weekly.percent);
      end ??= asEpochMs(weekly.resets_at);
    }
  }

  if (used === null && end === null) {
    return null;
  }

  const details: UsageDetail[] = [];

  for (const limit of limits.filter((entry) => entry.kind === "weekly_scoped")) {
    const name = scopeName(limit.scope);
    const percent = asNumber(limit.percent);
    if (name === null || percent === null) {
      continue;
    }
    const scopedEnd = asEpochMs(limit.resets_at) ?? end;
    details.push({
      label: `This week · ${name}`,
      usedPercent: clampPercent(percent),
      windowStart: scopedEnd === null ? null : scopedEnd - weekMs,
      windowEnd: scopedEnd,
      showElapsed: true,
      timeLabel: "Week",
    });
  }

  const session = limits.find((limit) => limit.kind === "session");
  const fiveHour = asRecord(root.five_hour);
  const sessionUsed = asNumber(session?.percent) ?? asNumber(fiveHour?.utilization);
  const sessionEnd = asEpochMs(session?.resets_at) ?? asEpochMs(fiveHour?.resets_at);
  if (sessionUsed !== null) {
    details.push({
      label: "5-hour session",
      usedPercent: clampPercent(sessionUsed),
      windowStart: sessionEnd === null ? null : sessionEnd - fiveHoursMs,
      windowEnd: sessionEnd,
      showElapsed: true,
      timeLabel: "Time",
    });
  }

  return {
    usedPercent: used === null ? null : clampPercent(used),
    windowStart: end === null ? null : end - weekMs,
    windowEnd: end,
    details,
  };
}

/**
 * Reads the current period from Cursor's `DashboardService/GetCurrentPeriodUsage` answer.
 * The answer is proto3 JSON, which leaves out fields whose value is zero.
 * Returns null when the plan has no included usage to measure.
 */
export function parseCursorUsage(body: unknown): Usage | null {
  const root = asRecord(body);
  if (root === null || root.enabled !== true) {
    return null;
  }
  const plan = asRecord(root.planUsage);
  if (plan === null) {
    return null;
  }
  const used = asNumber(plan.totalPercentUsed) ?? asNumber(plan.autoPercentUsed) ?? 0;
  const start = asEpochMs(root.billingCycleStart);
  const end = asEpochMs(root.billingCycleEnd);
  const validWindow = start !== null && end !== null && end > start;
  return {
    usedPercent: clampPercent(used),
    windowStart: validWindow ? start : null,
    windowEnd: validWindow ? end : null,
    details: [],
  };
}

/**
 * Reads Grok Bot's share of the weekly limit from Cursor's `DashboardService/GetGrokBotUsageBreakdown`.
 * `weeklyLimitPpm.bySource` lists parts per million of the limit per day and source; their sum is the
 * share used this week. Returns null when the account has no weekly breakdown or no Grok Bot use.
 */
export function parseGrokBotShare(body: unknown): Meter | null {
  const splits = asRecord(asRecord(body)?.weeklyLimitPpm);
  if (splits === null) {
    return null;
  }
  const sources = Array.isArray(splits.bySource) ? splits.bySource : [];
  const ppm = sources.reduce((sum: number, entry) => sum + (asNumber(asRecord(entry)?.ppm) ?? 0), 0);
  if (ppm <= 0) {
    // No Grok Bot use reported (or no Grok Bot on this plan): show no split rather than "Grok Bot 0%".
    return null;
  }
  const start = asEpochMs(splits.periodStartMs);
  const end = asEpochMs(splits.periodEndMs);
  const validWindow = start !== null && end !== null && end > start;
  return {
    usedPercent: clampPercent(ppm / 10_000),
    windowStart: validWindow ? start : null,
    windowEnd: validWindow ? end : null,
  };
}

/** Windows from different endpoints may differ by a few milliseconds. */
const sameWindowToleranceMs = 60_000;

function sameWindow(a: Meter, b: Meter): boolean {
  if (a.windowStart === null || a.windowEnd === null || b.windowStart === null || b.windowEnd === null) {
    return false;
  }
  return (
    Math.abs(a.windowStart - b.windowStart) <= sameWindowToleranceMs &&
    Math.abs(a.windowEnd - b.windowEnd) <= sameWindowToleranceMs
  );
}

/**
 * Splits Cursor's weekly total into Grok Bot and everything else. On merged Cursor and Grok plans
 * both draw from one weekly limit, so Grok Bot's share is part of the total. The split is only shown
 * when both answers cover the same week. When Grok Bot reports more than the total, the two can't be
 * one pool, so only Grok Bot's own number is shown.
 */
export function withGrokBotSplit(cursor: Usage, grok: Meter | null): Usage {
  if (grok === null || grok.usedPercent === null || cursor.usedPercent === null || !sameWindow(cursor, grok)) {
    return cursor;
  }
  const grokDetail: UsageDetail = {
    label: "Grok Bot",
    usedPercent: grok.usedPercent,
    windowStart: cursor.windowStart,
    windowEnd: cursor.windowEnd,
    showElapsed: false,
    timeLabel: "Week",
  };
  if (grok.usedPercent > cursor.usedPercent + 0.5) {
    return { ...cursor, details: [grokDetail] };
  }
  // The panel rounds percents down. Using whole percents here keeps Cursor + Grok Bot equal to the
  // total shown above them (16% = 3% + 13%, not 2% + 13%).
  const cursorDetail: UsageDetail = {
    ...grokDetail,
    label: "Cursor",
    usedPercent: clampPercent(Math.floor(cursor.usedPercent) - Math.floor(grok.usedPercent)),
  };
  return { ...cursor, details: [cursorDetail, grokDetail] };
}

/** Claude Code keeps its login in the Keychain as JSON. */
export function parseClaudeCredentials(text: string): { accessToken: string; expiresAt: number | null } | null {
  try {
    const oauth = asRecord(asRecord(JSON.parse(text))?.claudeAiOauth);
    const accessToken = oauth?.accessToken;
    if (typeof accessToken !== "string" || accessToken === "") {
      return null;
    }
    return { accessToken, expiresAt: asEpochMs(oauth?.expiresAt) };
  } catch {
    return null;
  }
}

export const cursorEncryptedPrefix = "cursor-safe-storage:v1:";

export function isEncryptedCursorToken(stored: string): boolean {
  return stored.startsWith(cursorEncryptedPrefix);
}

/**
 * Decrypts a Cursor login sealed with Electron `safeStorage` on macOS:
 * "v10" + AES-128-CBC, key = PBKDF2-SHA1(Keychain password, "saltysalt", 1003 rounds), IV = 16 spaces.
 */
export function decryptCursorToken(stored: string, safeStoragePassword: string): string {
  if (!isEncryptedCursorToken(stored)) {
    throw new Error("The Cursor login is not in the expected encrypted format");
  }
  const blob = Buffer.from(stored.slice(cursorEncryptedPrefix.length), "base64");
  if (blob.subarray(0, 3).toString("latin1") !== "v10") {
    throw new Error("The Cursor login uses an unknown encryption version");
  }
  const key = pbkdf2Sync(safeStoragePassword, "saltysalt", 1003, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  const plain = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]).toString("utf8");
  return unquote(plain.trim());
}

/** Values in Cursor's state database are sometimes stored as JSON strings. */
export function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") {
        return parsed;
      }
    } catch {
      // Not JSON; use it as is.
    }
  }
  return value;
}

/** Expiry of a JWT in epoch milliseconds, or null when it has none or is not a JWT. */
export function jwtExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (payload === undefined) {
    return null;
  }
  try {
    const claims = asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return asEpochMs(claims?.exp);
  } catch {
    return null;
  }
}

/**
 * Moves a past window forward by whole periods until it contains `now`.
 * Usage from an earlier window does not carry over, so it becomes unknown.
 */
function rollMeter<T extends Meter>(meter: T, now: number): T {
  const { windowStart, windowEnd } = meter;
  if (windowStart === null || windowEnd === null || now < windowEnd) {
    return meter;
  }
  const period = windowEnd - windowStart;
  if (period <= 0) {
    return meter;
  }
  const periods = Math.floor((now - windowStart) / period);
  return {
    ...meter,
    usedPercent: null,
    windowStart: windowStart + periods * period,
    windowEnd: windowEnd + periods * period,
  };
}

const dayMs = 24 * 60 * 60 * 1000;

/**
 * Weekly limits run on a fixed schedule, so a past week rolls into the next one. A Claude session
 * starts with the next message, not on a schedule, so a past session is cleared instead of guessed.
 */
function rollDetail(detail: UsageDetail, now: number): UsageDetail {
  const { windowStart, windowEnd } = detail;
  if (windowStart !== null && windowEnd !== null && now >= windowEnd && windowEnd - windowStart < dayMs) {
    return { ...detail, usedPercent: null, windowStart: null, windowEnd: null };
  }
  return rollMeter(detail, now);
}

/** Rolls the main window and every detail forward to `now`. */
export function rollForward(usage: Usage, now: number): Usage {
  const rolled = rollMeter(usage, now);
  const details = usage.details.map((detail) => rollDetail(detail, now));
  const unchanged = rolled === usage && details.every((detail, index) => detail === usage.details[index]);
  return unchanged ? usage : { ...rolled, details };
}
