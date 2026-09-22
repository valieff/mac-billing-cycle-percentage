import { contextBridge, ipcRenderer } from "electron";

interface SaveSettings {
  resetDay: number;
  openAtLogin: boolean;
}

// Channel names match ipcChannels in settings-api.ts. The sandboxed preload cannot import that module.
const channels = {
  getState: "settings:get",
  saveSettings: "settings:save",
  quit: "app:quit",
  shown: "settings:shown",
} as const;

const settingsApi = {
  getState(): Promise<unknown> {
    return ipcRenderer.invoke(channels.getState);
  },
  saveSettings(settings: SaveSettings): Promise<void> {
    return ipcRenderer.invoke(channels.saveSettings, settings);
  },
  quit(): Promise<void> {
    return ipcRenderer.invoke(channels.quit);
  },
  onDidShow(listener: () => void): void {
    ipcRenderer.on(channels.shown, () => {
      listener();
    });
  },
};

contextBridge.exposeInMainWorld("settingsApi", settingsApi);
