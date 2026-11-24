import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { defaultSettings, type AppSettings } from "./settings-api.js";

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

export function updateSettings(change: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...change };
  saveSettings(next);
  return next;
}

/** Keys from older versions (reset days and times) are dropped. */
function normalizeSettings(value: unknown): AppSettings {
  if (typeof value !== "object" || value === null) {
    return { ...defaultSettings };
  }
  const record = value as Record<string, unknown>;
  const flag = (key: keyof AppSettings): boolean =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : defaultSettings[key];
  return {
    openAtLogin: flag("openAtLogin"),
    claudeEnabled: flag("claudeEnabled"),
    cursorEnabled: flag("cursorEnabled"),
    onboarded: flag("onboarded"),
  };
}
