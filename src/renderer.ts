interface CycleSnapshot {
  elapsedDays: number;
  totalDays: number;
  percent: number;
}

interface AppState {
  resetDay: number | null;
  openAtLogin: boolean;
  progress: CycleSnapshot | null;
  menuBarClipped: boolean;
}

interface SaveSettings {
  resetDay: number;
  openAtLogin: boolean;
}

interface SettingsApi {
  getState: () => Promise<AppState>;
  saveSettings: (settings: SaveSettings) => Promise<void>;
  quit: () => Promise<void>;
  onDidShow: (listener: () => void) => void;
}

declare global {
  interface Window {
    settingsApi: SettingsApi;
  }
}

function requireSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Missing select #${id}`);
  }
  return element;
}

function requireCheckbox(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement) || element.type !== "checkbox") {
    throw new Error(`Missing checkbox #${id}`);
  }
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Missing button #${id}`);
  }
  return element;
}

function requireParagraph(id: string): HTMLParagraphElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLParagraphElement)) {
    throw new Error(`Missing paragraph #${id}`);
  }
  return element;
}

function fillDays(select: HTMLSelectElement, selected: number | null): void {
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a day";
  placeholder.disabled = true;
  placeholder.selected = selected === null;
  select.append(placeholder);
  for (let day = 1; day <= 31; day += 1) {
    const option = document.createElement("option");
    option.value = String(day);
    option.textContent = String(day);
    option.selected = day === selected;
    select.append(option);
  }
}

function showSummary(summary: HTMLParagraphElement, state: AppState): void {
  if (state.progress === null) {
    summary.hidden = true;
    summary.textContent = "";
    return;
  }
  summary.hidden = false;
  summary.textContent = `This cycle: ${state.progress.elapsedDays} of ${state.progress.totalDays} days (${state.progress.percent}%).`;
}

function showClipWarning(warning: HTMLParagraphElement, state: AppState): void {
  warning.hidden = !state.menuBarClipped;
}

async function init(): Promise<void> {
  const select = requireSelect("reset-day");
  const openAtLogin = requireCheckbox("open-at-login");
  const saveButton = requireButton("save");
  const quitButton = requireButton("quit");
  const summary = requireParagraph("summary");
  const clipped = requireParagraph("clipped");
  const form = document.getElementById("settings");
  if (!(form instanceof HTMLFormElement)) {
    throw new Error("Missing settings form");
  }

  let renderedOnce = false;

  async function renderState(): Promise<void> {
    const state = await window.settingsApi.getState();
    const selectedDay = select.value === "" ? null : Number(select.value);
    const dayDirty = renderedOnce && selectedDay !== state.resetDay;
    if (!dayDirty) {
      fillDays(select, state.resetDay);
    }
    const loginDirty = renderedOnce && openAtLogin.checked !== state.openAtLogin;
    if (!loginDirty) {
      openAtLogin.checked = state.openAtLogin;
    }
    renderedOnce = true;
    showSummary(summary, state);
    showClipWarning(clipped, state);
    saveButton.disabled = false;
  }

  await renderState();
  window.settingsApi.onDidShow(() => {
    void renderState();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const resetDay = Number(select.value);
    if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) {
      select.reportValidity();
      return;
    }
    saveButton.disabled = true;
    void window.settingsApi
      .saveSettings({ resetDay, openAtLogin: openAtLogin.checked })
      .catch(() => {
        saveButton.disabled = false;
      });
  });

  quitButton.addEventListener("click", () => {
    void window.settingsApi.quit();
  });
}

void init();

export { };

