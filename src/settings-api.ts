export interface AppSettings {
  resetDay: number | null;
  openAtLogin: boolean;
}

export interface CycleSnapshot {
  elapsedDays: number;
  totalDays: number;
  percent: number;
}

export interface AppState extends AppSettings {
  progress: CycleSnapshot | null;
  menuBarClipped: boolean;
}

export interface SaveSettings {
  resetDay: number;
  openAtLogin: boolean;
}

export const ipcChannels = {
  getState: "settings:get",
  saveSettings: "settings:save",
  quit: "app:quit",
  shown: "settings:shown",
} as const;

export function isValidResetDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

export function parseSaveSettings(payload: unknown): SaveSettings {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Settings must be an object");
  }
  const record = payload as Record<string, unknown>;
  if (!isValidResetDay(record.resetDay)) {
    throw new Error("Reset day must be an integer from 1 to 31");
  }
  if (typeof record.openAtLogin !== "boolean") {
    throw new Error("Open at login must be a boolean");
  }
  return { resetDay: record.resetDay, openAtLogin: record.openAtLogin };
}
