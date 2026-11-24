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
import {
  ipcChannels,
  parseBoolean,
  parseHeight,
  parseProviderId,
  type AppSettings,
  type AppState,
  type ConnectResult,
} from "./settings-api.js";
import { loadSettings, updateSettings } from "./store.js";
import { BarsRenderer } from "./tray-icon.js";
import { UsageService, type ProviderView } from "./usage/service.js";
import type { ProviderId } from "./usage/types.js";

const panelWidth = 320;

let tray: Tray | null = null;
let trayBars: BarsRenderer | null = null;
let trayRefreshId = 0;
let panel: BrowserWindow | null = null;
let usage: UsageService | null = null;
let openedAt = 0;
let hiddenAt = 0;
/** Connect clicks still waiting (possibly on a Keychain prompt), so losing focus doesn't hide the panel. */
let connecting = 0;
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

function isEnabled(id: ProviderId, settings: AppSettings = loadSettings()): boolean {
  return id === "claude" ? settings.claudeEnabled : settings.cursorEnabled;
}

function currentState(): AppState {
  return {
    ...loadSettings(),
    providers: usage?.views() ?? [],
    menuBarClipped: isTrayClipped(),
  };
}

const resetFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function tooltipLine(view: ProviderView): string {
  if (view.status === "off") {
    return `${view.name}: not connected`;
  }
  const parts = [
    view.usedPercent === null ? "usage unknown" : `${view.usedPercent}% used`,
    view.elapsedPercent === null ? null : `${view.elapsedPercent}% of the week gone`,
    view.windowEnd === null ? null : `resets ${resetFormat.format(view.windowEnd)}`,
  ].filter((part) => part !== null);
  return `${view.name}: ${parts.join(" · ")}`;
}

function refreshTray(): void {
  if (tray === null || usage === null) {
    return;
  }
  const views = usage.views();
  const [claude, cursor] = views as [ProviderView, ProviderView];
  tray.setToolTip(views.map(tooltipLine).join("\n"));
  const refreshId = ++trayRefreshId;
  void trayBars
    ?.render([
      { used: claude.usedFraction, elapsed: claude.elapsedFraction },
      { used: cursor.usedFraction, elapsed: cursor.elapsedFraction },
    ], nativeTheme.shouldUseDarkColors)
    .then((image) => {
      if (tray === null || refreshId !== trayRefreshId) {
        return;
      }
      tray.setImage(image);
      tray.setTitle("");
    })
    .catch((error: unknown) => {
      console.error("Could not draw the tray bars", error);
      if (tray !== null && refreshId === trayRefreshId) {
        const text = (view: ProviderView) => (view.usedPercent === null ? "–" : `${view.usedPercent}%`);
        tray.setImage(nativeImage.createEmpty());
        tray.setTitle(`${text(claude)} ${text(cursor)}`, { fontType: "monospacedDigit" });
      }
    });
}

/** Redraws the tray and tells an open panel that the numbers changed. */
function publishState(): void {
  refreshTray();
  if (panel !== null && panel.isVisible()) {
    panel.webContents.send(ipcChannels.stateChanged);
  }
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#f4f4f5";
}

function createPanel(): BrowserWindow {
  const window = new BrowserWindow({
    width: panelWidth,
    height: 420,
    useContentSize: true,
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
    if (Date.now() - openedAt < 250 || !canDismissPanel()) {
      return;
    }
    hidePanel();
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape" && canDismissPanel()) {
      hidePanel();
      event.preventDefault();
    }
  });

  return window;
}

function positionPanel(): void {
  if (tray === null || panel === null) {
    return;
  }
  const trayBounds = tray.getBounds();
  const windowBounds = panel.getBounds();
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 4);
  if (trayBounds.width === 0 || trayBounds.height === 0) {
    const { workArea } = screen.getPrimaryDisplay();
    x = workArea.x + workArea.width - windowBounds.width - 12;
    y = workArea.y + 8;
  }
  const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - windowBounds.width);
  panel.setPosition(x, y, false);
}

function canDismissPanel(): boolean {
  return connecting === 0 && loadSettings().onboarded && !isTrayClipped();
}

function hidePanel(): void {
  if (panel === null) {
    return;
  }
  hiddenAt = Date.now();
  panel.hide();
}

function showPanel(): void {
  if (panel === null) {
    return;
  }
  openedAt = Date.now();
  positionPanel();
  panel.show();
  panel.focus();
  panel.webContents.send(ipcChannels.shown);
  usage?.refreshStale();
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  tray.setIgnoreDoubleClickEvents(true);
  tray.on("click", () => {
    if (panel === null) {
      return;
    }
    if (panel.isVisible()) {
      if (canDismissPanel()) {
        hidePanel();
      } else {
        panel.focus();
      }
      return;
    }
    if (Date.now() - hiddenAt < 250) {
      return;
    }
    showPanel();
  });
  refreshTray();
}

function applyLoginItem(openAtLogin: boolean): void {
  if (!app.isPackaged) {
    return;
  }
  app.setLoginItemSettings({ openAtLogin });
}

function registerIpc(): void {
  ipcMain.handle(ipcChannels.getState, (): AppState => currentState());

  ipcMain.handle(ipcChannels.connect, async (_event: IpcMainInvokeEvent, payload: unknown): Promise<ConnectResult> => {
    const id = parseProviderId(payload);
    if (usage === null) {
      return { ok: false, message: "Still starting up. Try again in a moment." };
    }
    connecting += 1;
    try {
      const result = await usage.connect(id);
      if (result.kind === "ok") {
        updateSettings(id === "claude" ? { claudeEnabled: true } : { cursorEnabled: true });
        publishState();
        return { ok: true, message: null };
      }
      publishState();
      return { ok: false, message: result.message };
    } finally {
      connecting -= 1;
      if (connecting === 0) {
        panel?.focus();
      }
    }
  });

  ipcMain.handle(ipcChannels.disconnect, async (_event: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
    const id = parseProviderId(payload);
    updateSettings(id === "claude" ? { claudeEnabled: false } : { cursorEnabled: false });
    await usage?.disconnect(id);
    publishState();
  });

  ipcMain.handle(ipcChannels.refresh, (): void => {
    usage?.refreshAll();
  });

  ipcMain.handle(ipcChannels.setOpenAtLogin, (_event: IpcMainInvokeEvent, payload: unknown): void => {
    const openAtLogin = parseBoolean(payload);
    updateSettings({ openAtLogin });
    applyLoginItem(openAtLogin);
  });

  ipcMain.handle(ipcChannels.finishOnboarding, (): void => {
    updateSettings({ onboarded: true });
    if (canDismissPanel()) {
      hidePanel();
    }
  });

  ipcMain.handle(ipcChannels.resize, (_event: IpcMainInvokeEvent, payload: unknown): void => {
    if (panel === null) {
      return;
    }
    const height = parseHeight(payload);
    const [, current] = panel.getContentSize();
    if (current !== height) {
      panel.setContentSize(panelWidth, height, false);
    }
  });

  ipcMain.handle(ipcChannels.quit, (): void => {
    app.quit();
  });
}

nativeTheme.on("updated", () => {
  panel?.setBackgroundColor(windowBackground());
  // The tray image keeps its colors, so its neutral parts must follow the menu bar.
  refreshTray();
});

// A second launch would add a second set of bars to the menu bar, so it quits and leaves the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

void app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) {
    return;
  }
  if (process.platform !== "darwin") {
    console.error("Billing Cycle only runs on macOS.");
    app.quit();
    return;
  }

  if (app.dock) {
    app.dock.hide();
  }

  applyLoginItem(loadSettings().openAtLogin);

  usage = new UsageService((id) => isEnabled(id), publishState);
  registerIpc();
  panel = createPanel();
  trayBars = new BarsRenderer();
  createTray();

  // Each minute: redraw the week bars (no network) and fetch any provider that is due.
  const tick = (): void => {
    usage?.refreshDue();
    refreshTray();
  };
  tick();
  const timer = setInterval(tick, 60_000);
  powerMonitor.on("resume", () => {
    usage?.refreshStale();
    refreshTray();
  });
  app.on("before-quit", () => {
    clearInterval(timer);
  });

  // The panel opens by itself only on first launch, for onboarding. After that, launches stay quiet.
  setTimeout(() => {
    if (panel === null || panel.isVisible()) {
      return;
    }
    if (!loadSettings().onboarded) {
      showPanel();
    }
  }, 400);
});

app.on("window-all-closed", () => {
  // The menu bar icon keeps the process alive.
});
