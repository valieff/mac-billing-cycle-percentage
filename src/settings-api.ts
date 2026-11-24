import type { ProviderView } from "./usage/service.js";
import type { ProviderId } from "./usage/types.js";

export interface AppSettings {
  openAtLogin: boolean;
  claudeEnabled: boolean;
  cursorEnabled: boolean;
  /** False until the user finishes the first-run panel. */
  onboarded: boolean;
}

export interface AppState extends AppSettings {
  providers: ProviderView[];
  menuBarClipped: boolean;
}

export interface ConnectResult {
  ok: boolean;
  message: string | null;
}

export const defaultSettings: AppSettings = {
  openAtLogin: true,
  claudeEnabled: false,
  cursorEnabled: false,
  onboarded: false,
};

export const ipcChannels = {
  getState: "panel:get-state",
  connect: "panel:connect",
  disconnect: "panel:disconnect",
  refresh: "panel:refresh",
  setOpenAtLogin: "panel:set-open-at-login",
  finishOnboarding: "panel:finish-onboarding",
  resize: "panel:resize",
  quit: "app:quit",
  shown: "panel:shown",
  stateChanged: "panel:state-changed",
} as const;

export function parseProviderId(value: unknown): ProviderId {
  if (value === "claude" || value === "cursor") {
    return value;
  }
  throw new Error("Unknown provider");
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("Expected a boolean");
  }
  return value;
}

export function parseHeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Expected a height");
  }
  return Math.round(Math.min(800, Math.max(120, value)));
}
