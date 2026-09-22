import {
    app,
    BrowserWindow,
    ipcMain,
    nativeImage,
    nativeTheme,
    powerMonitor,
    screen,
    Tray,
    type IpcMainInvokeEvent,
} from "electron";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { cycleProgress } from "./cycle.js";
import { ipcChannels, parseSaveSettings, type AppState, type SaveSettings } from "./settings-api.js";
import { loadSettings, saveSettings } from "./store.js";

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let openedAt = 0;
let hiddenAt = 0;
let cachedStatusAreaMinX: number | null = null;

function statusAreaMinX(): number | null {
  if (cachedStatusAreaMinX !== null) {
    return cachedStatusAreaMinX;
  }
  try {
    const output = execFileSync(
      "osascript",
      [
        "-e",
        'use framework "AppKit"',
        "-e",
        "set area to current application's NSScreen's mainScreen()'s auxiliaryTopRightArea()",
        "-e",
        'if area is missing value then return "0"',
        "-e",
        "return area as text",
      ],
      { encoding: "utf8", timeout: 3000 },
    );
    const match = /^(\d+)/.exec(output.trim());
    const value = match === null ? Number.NaN : Number(match[1]);
    cachedStatusAreaMinX = Number.isFinite(value) ? value : 0;
    return cachedStatusAreaMinX;
  } catch {
    return null;
  }
}

function isTrayClipped(): boolean {
  if (tray === null) {
    return false;
  }
  const bounds = tray.getBounds();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return false;
  }
  const minX = statusAreaMinX();
  if (minX === null || minX <= 0) {
    return false;
  }
  return bounds.x + bounds.width <= minX;
}

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${day}th`;
  }
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function currentState(): AppState {
  const settings = loadSettings();
  if (settings.resetDay === null) {
    return { ...settings, progress: null, menuBarClipped: isTrayClipped() };
  }
  const progress = cycleProgress(new Date(), settings.resetDay);
  return {
    resetDay: settings.resetDay,
    openAtLogin: settings.openAtLogin,
    progress: {
      elapsedDays: progress.elapsedDays,
      totalDays: progress.totalDays,
      percent: progress.percent,
    },
    menuBarClipped: isTrayClipped(),
  };
}

function applyLoginItem(openAtLogin: boolean): void {
  if (!app.isPackaged) {
    return;
  }
  app.setLoginItemSettings({ openAtLogin });
}

function refreshTray(): void {
  if (tray === null) {
    return;
  }
  const state = currentState();
  if (state.progress === null || state.resetDay === null) {
    tray.setTitle("—");
    tray.setToolTip("Choose the day your billing cycle resets");
    return;
  }
  tray.setTitle(`${state.progress.percent}%`, { fontType: "monospacedDigit" });
  tray.setToolTip(
    `${state.progress.elapsedDays} of ${state.progress.totalDays} days · resets on the ${ordinal(state.resetDay)}`,
  );
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#f4f4f5";
}

function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 320,
    height: 390,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    roundedCorners: true,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setAlwaysOnTop(true, "pop-up-menu");
  void window.loadFile(path.join(__dirname, "settings.html"));

  window.on("blur", () => {
    if (Date.now() - openedAt < 250 || !canDismissSettings()) {
      return;
    }
    hideSettingsWindow();
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape" && canDismissSettings()) {
      hideSettingsWindow();
      event.preventDefault();
    }
  });

  return window;
}

function positionSettingsWindow(): void {
  if (tray === null || settingsWindow === null) {
    return;
  }
  const trayBounds = tray.getBounds();
  const windowBounds = settingsWindow.getBounds();
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 4);
  if (trayBounds.width === 0 || trayBounds.height === 0) {
    const { workArea } = screen.getPrimaryDisplay();
    x = workArea.x + workArea.width - windowBounds.width - 12;
    y = workArea.y + 8;
  }
  const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - windowBounds.width);
  settingsWindow.setPosition(x, y, false);
}

function canDismissSettings(): boolean {
  return loadSettings().resetDay !== null && !isTrayClipped();
}

function hideSettingsWindow(): void {
  if (settingsWindow === null) {
    return;
  }
  hiddenAt = Date.now();
  settingsWindow.hide();
}

function showSettingsWindow(): void {
  if (settingsWindow === null) {
    return;
  }
  openedAt = Date.now();
  positionSettingsWindow();
  settingsWindow.show();
  settingsWindow.focus();
  settingsWindow.webContents.send(ipcChannels.shown);
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  tray.setIgnoreDoubleClickEvents(true);
  tray.on("click", () => {
    if (settingsWindow === null) {
      return;
    }
    if (settingsWindow.isVisible()) {
      if (canDismissSettings()) {
        hideSettingsWindow();
      } else {
        settingsWindow.focus();
      }
      return;
    }
    if (Date.now() - hiddenAt < 250) {
      return;
    }
    showSettingsWindow();
  });
  refreshTray();
}

function registerIpc(): void {
  ipcMain.handle(ipcChannels.getState, (): AppState => currentState());

  ipcMain.handle(ipcChannels.saveSettings, (_event: IpcMainInvokeEvent, payload: unknown): void => {
    const saved: SaveSettings = parseSaveSettings(payload);
    saveSettings(saved);
    applyLoginItem(saved.openAtLogin);
    refreshTray();
    if (canDismissSettings()) {
      hideSettingsWindow();
      return;
    }
    settingsWindow?.webContents.send(ipcChannels.shown);
  });

  ipcMain.handle(ipcChannels.quit, (): void => {
    app.quit();
  });
}

nativeTheme.on("updated", () => {
  settingsWindow?.setBackgroundColor(windowBackground());
});

void app.whenReady().then(() => {
  if (process.platform !== "darwin") {
    console.error("Days Percentage only runs on macOS.");
    app.quit();
    return;
  }

  if (app.dock) {
    app.dock.hide();
  }

  applyLoginItem(loadSettings().openAtLogin);
  registerIpc();
  settingsWindow = createSettingsWindow();
  createTray();

  const refreshTimer = setInterval(refreshTray, 60_000);
  powerMonitor.on("resume", refreshTray);
  app.on("before-quit", () => {
    clearInterval(refreshTimer);
  });

  if (loadSettings().resetDay === null) {
    showSettingsWindow();
  }

  setTimeout(() => {
    if (settingsWindow === null || settingsWindow.isVisible()) {
      return;
    }
    if (loadSettings().resetDay === null || isTrayClipped()) {
      showSettingsWindow();
    }
  }, 400);
});

app.on("window-all-closed", () => {
  // The menu bar icon keeps the process alive.
});
