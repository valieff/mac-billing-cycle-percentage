import { contextBridge, ipcRenderer } from "electron";

// Channel names match ipcChannels in settings-api.ts. The sandboxed preload cannot import that module.
const channels = {
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

const panelApi = {
  getState(): Promise<unknown> {
    return ipcRenderer.invoke(channels.getState);
  },
  connect(provider: "claude" | "cursor"): Promise<unknown> {
    return ipcRenderer.invoke(channels.connect, provider);
  },
  disconnect(provider: "claude" | "cursor"): Promise<void> {
    return ipcRenderer.invoke(channels.disconnect, provider);
  },
  refresh(): Promise<void> {
    return ipcRenderer.invoke(channels.refresh);
  },
  setOpenAtLogin(openAtLogin: boolean): Promise<void> {
    return ipcRenderer.invoke(channels.setOpenAtLogin, openAtLogin);
  },
  finishOnboarding(): Promise<void> {
    return ipcRenderer.invoke(channels.finishOnboarding);
  },
  resize(height: number): Promise<void> {
    return ipcRenderer.invoke(channels.resize, height);
  },
  quit(): Promise<void> {
    return ipcRenderer.invoke(channels.quit);
  },
  onDidShow(listener: () => void): void {
    ipcRenderer.on(channels.shown, () => listener());
  },
  onStateChanged(listener: () => void): void {
    ipcRenderer.on(channels.stateChanged, () => listener());
  },
};

contextBridge.exposeInMainWorld("panelApi", panelApi);
