import { parseTimeOfDay } from "./cycle.js";

export interface AppSettings {
  resetDay: number | null;
  /** Local time of the monthly reset, "HH:MM". */
  resetTime: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekResetDay: number;
  /** Local time of the weekly reset, "HH:MM". */
  weekResetTime: string;
  openAtLogin: boolean;
}

export interface PeriodSnapshot {
  /** Epoch milliseconds. */
  start: number;
  /** Epoch milliseconds. */
  end: number;
  percent: number;
}

export interface AppState extends AppSettings {
  month: PeriodSnapshot | null;
  week: PeriodSnapshot;
  menuBarClipped: boolean;
}

export interface SaveSettings extends AppSettings {
  resetDay: number;
}

export const defaultSettings: AppSettings = {
  resetDay: null,
  resetTime: "00:00",
  weekResetDay: 1,
  weekResetTime: "00:00",
  openAtLogin: true,
};

export const ipcChannels = {
  getState: "settings:get",
  saveSettings: "settings:save",
  quit: "app:quit",
  shown: "settings:shown",
} as const;

export function isValidResetDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

export function isValidWeekday(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && parseTimeOfDay(value) !== null;
}

export function parseSaveSettings(payload: unknown): SaveSettings {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Settings must be an object");
  }
  const record = payload as Record<string, unknown>;
  if (!isValidResetDay(record.resetDay)) {
    throw new Error("Reset day must be an integer from 1 to 31");
  }
  if (!isValidTime(record.resetTime)) {
    throw new Error("Reset time must be HH:MM");
  }
  if (!isValidWeekday(record.weekResetDay)) {
    throw new Error("Week reset day must be an integer from 0 to 6");
  }
  if (!isValidTime(record.weekResetTime)) {
    throw new Error("Week reset time must be HH:MM");
  }
  if (typeof record.openAtLogin !== "boolean") {
    throw new Error("Open at login must be a boolean");
  }
  return {
    resetDay: record.resetDay,
    resetTime: record.resetTime,
    weekResetDay: record.weekResetDay,
    weekResetTime: record.weekResetTime,
    openAtLogin: record.openAtLogin,
  };
}
