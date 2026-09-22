import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { isValidResetDay, type AppSettings } from "./settings-api.js";

const defaultSettings: AppSettings = {
  resetDay: null,
  openAtLogin: true,
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function loadSettings(): AppSettings {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return normalizeSettings(parsed);
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: AppSettings): void {
  const directory = app.getPath("userData");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

function normalizeSettings(value: unknown): AppSettings {
  if (typeof value !== "object" || value === null) {
    return { ...defaultSettings };
  }
  const record = value as Record<string, unknown>;
  return {
    resetDay: isValidResetDay(record.resetDay) ? record.resetDay : null,
    openAtLogin: typeof record.openAtLogin === "boolean" ? record.openAtLogin : true,
  };
}
