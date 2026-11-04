interface PeriodSnapshot {
  start: number;
  end: number;
  percent: number;
}

interface AppState {
  resetDay: number | null;
  resetTime: string;
  weekResetDay: number;
  weekResetTime: string;
  openAtLogin: boolean;
  month: PeriodSnapshot | null;
  week: PeriodSnapshot;
  menuBarClipped: boolean;
}

interface SaveSettings {
  resetDay: number;
  resetTime: string;
  weekResetDay: number;
  weekResetTime: string;
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

const weekdays: ReadonlyArray<[number, string]> = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [0, "Sunday"],
];

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

function fillOptions(
  select: HTMLSelectElement,
  options: ReadonlyArray<[number, string]>,
  selected: number | null,
  placeholderText?: string,
): void {
  select.replaceChildren();
  if (placeholderText !== undefined) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = placeholderText;
    placeholder.disabled = true;
    placeholder.selected = selected === null;
    select.append(placeholder);
  }
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
}

const monthDays: ReadonlyArray<[number, string]> = Array.from({ length: 31 }, (_, index) => [index + 1, String(index + 1)]);

const resetFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function describe(label: string, period: PeriodSnapshot): string {
  return `${label}: ${period.percent}% gone · resets ${resetFormat.format(new Date(period.end))}`;
}

function showSummary(summary: HTMLParagraphElement, state: AppState): void {
  const lines = [describe("Week", state.week)];
  if (state.month !== null) {
    lines.unshift(describe("Month", state.month));
  }
  summary.hidden = false;
  summary.replaceChildren(
    ...lines.flatMap((line, index) => (index === 0 ? [line] : [document.createElement("br"), line])),
  );
}

async function init(): Promise<void> {
  const daySelect = requireElement("reset-day", HTMLSelectElement);
  const timeInput = requireElement("reset-time", HTMLInputElement);
  const weekdaySelect = requireElement("week-reset-day", HTMLSelectElement);
  const weekTimeInput = requireElement("week-reset-time", HTMLInputElement);
  const openAtLogin = requireElement("open-at-login", HTMLInputElement);
  const saveButton = requireElement("save", HTMLButtonElement);
  const quitButton = requireElement("quit", HTMLButtonElement);
  const summary = requireElement("summary", HTMLParagraphElement);
  const clipped = requireElement("clipped", HTMLParagraphElement);
  const form = requireElement("settings", HTMLFormElement);

  // Fields the user edited since the last save keep their value when the window reopens.
  const dirty = new Set<HTMLElement>();
  for (const field of [daySelect, timeInput, weekdaySelect, weekTimeInput, openAtLogin]) {
    field.addEventListener("input", () => dirty.add(field));
    field.addEventListener("change", () => dirty.add(field));
  }

  async function renderState(): Promise<void> {
    const state = await window.settingsApi.getState();
    if (!dirty.has(daySelect)) {
      fillOptions(daySelect, monthDays, state.resetDay, "Choose a day");
    }
    if (!dirty.has(timeInput)) {
      timeInput.value = state.resetTime;
    }
    if (!dirty.has(weekdaySelect)) {
      fillOptions(weekdaySelect, weekdays, state.weekResetDay);
    }
    if (!dirty.has(weekTimeInput)) {
      weekTimeInput.value = state.weekResetTime;
    }
    if (!dirty.has(openAtLogin)) {
      openAtLogin.checked = state.openAtLogin;
    }
    showSummary(summary, state);
    clipped.hidden = !state.menuBarClipped;
    saveButton.disabled = false;
  }

  await renderState();
  window.settingsApi.onDidShow(() => {
    void renderState();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const resetDay = Number(daySelect.value);
    const weekResetDay = Number(weekdaySelect.value);
    if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) {
      daySelect.reportValidity();
      return;
    }
    if (!timePattern.test(timeInput.value)) {
      timeInput.reportValidity();
      return;
    }
    if (!Number.isInteger(weekResetDay) || weekResetDay < 0 || weekResetDay > 6) {
      weekdaySelect.reportValidity();
      return;
    }
    if (!timePattern.test(weekTimeInput.value)) {
      weekTimeInput.reportValidity();
      return;
    }
    saveButton.disabled = true;
    void window.settingsApi
      .saveSettings({
        resetDay,
        resetTime: timeInput.value,
        weekResetDay,
        weekResetTime: weekTimeInput.value,
        openAtLogin: openAtLogin.checked,
      })
      .then(() => {
        dirty.clear();
        return renderState();
      })
      .catch(() => {
        saveButton.disabled = false;
      });
  });

  quitButton.addEventListener("click", () => {
    void window.settingsApi.quit();
  });
}

void init();

export {};
