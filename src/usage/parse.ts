import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import type { Usage } from "./types.js";

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

/**
 * Reads the weekly limit from Claude's `GET /api/oauth/usage` answer.
 * Returns null when the answer has no weekly limit (for example on Enterprise plans).
 */
export function parseClaudeUsage(body: unknown): Usage | null {
  const root = asRecord(body);
  if (root === null) {
    return null;
  }

  let used: number | null = null;
  let end: number | null = null;

  const sevenDay = asRecord(root.seven_day);
  if (sevenDay !== null) {
    used = asNumber(sevenDay.utilization);
    end = asEpochMs(sevenDay.resets_at);
  }

  if (used === null || end === null) {
    const limits = Array.isArray(root.limits) ? root.limits : [];
    const weekly = limits.map(asRecord).find((limit) => limit?.kind === "weekly_all");
    if (weekly) {
      used ??= asNumber(weekly.percent);
      end ??= asEpochMs(weekly.resets_at);
    }
  }

  if (used === null && end === null) {
    return null;
  }
  return {
    usedPercent: used === null ? null : clampPercent(used),
    windowStart: end === null ? null : end - weekMs,
    windowEnd: end,
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
  };
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
export function rollForward(usage: Usage, now: number): Usage {
  const { windowStart, windowEnd } = usage;
  if (windowStart === null || windowEnd === null || now < windowEnd) {
    return usage;
  }
  const period = windowEnd - windowStart;
  if (period <= 0) {
    return usage;
  }
  const periods = Math.floor((now - windowStart) / period);
  return {
    usedPercent: null,
    windowStart: windowStart + periods * period,
    windowEnd: windowEnd + periods * period,
  };
}
