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

const hours: ReadonlyArray<[number, string]> = Array.from({ length: 24 }, (_, hour) => [hour, pad(hour)]);
const minutes: ReadonlyArray<[number, string]> = Array.from({ length: 60 }, (_, minute) => [minute, pad(minute)]);

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

interface TimeFields {
  hour: HTMLSelectElement;
  minute: HTMLSelectElement;
}

function fillTime(fields: TimeFields, value: string): void {
  const [hour, minute] = value.split(":").map(Number);
  fillOptions(fields.hour, hours, hour ?? 0);
  fillOptions(fields.minute, minutes, minute ?? 0);
}

function readTime(fields: TimeFields): string {
  return `${pad(Number(fields.hour.value))}:${pad(Number(fields.minute.value))}`;
}

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
  hourCycle: "h23",
});

function describe(label: string, period: PeriodSnapshot): string {
  return `${label}: ${period.percent}% · resets ${resetFormat.format(new Date(period.end))}`;
}

function showSummary(summary: HTMLParagraphElement, state: AppState): void {
  const lines = [describe("Claude Code", state.week)];
  if (state.month !== null) {
    lines.unshift(describe("Cursor", state.month));
  }
  summary.hidden = false;
  summary.replaceChildren(
    ...lines.flatMap((line, index) => (index === 0 ? [line] : [document.createElement("br"), line])),
  );
}

async function init(): Promise<void> {
  const daySelect = requireElement("reset-day", HTMLSelectElement);
  const resetTime: TimeFields = {
    hour: requireElement("reset-hour", HTMLSelectElement),
    minute: requireElement("reset-minute", HTMLSelectElement),
  };
  const weekdaySelect = requireElement("week-reset-day", HTMLSelectElement);
  const weekResetTime: TimeFields = {
    hour: requireElement("week-reset-hour", HTMLSelectElement),
    minute: requireElement("week-reset-minute", HTMLSelectElement),
  };
  const openAtLogin = requireElement("open-at-login", HTMLInputElement);
  const saveButton = requireElement("save", HTMLButtonElement);
  const quitButton = requireElement("quit", HTMLButtonElement);
  const summary = requireElement("summary", HTMLParagraphElement);
  const clipped = requireElement("clipped", HTMLParagraphElement);
  const form = requireElement("settings", HTMLFormElement);

  // Fields the user edited since the last save keep their value when the window reopens.
  const dirty = new Set<HTMLElement>();
  const fields = [
    daySelect,
    resetTime.hour,
    resetTime.minute,
    weekdaySelect,
    weekResetTime.hour,
    weekResetTime.minute,
    openAtLogin,
  ];
  for (const field of fields) {
    field.addEventListener("input", () => dirty.add(field));
    field.addEventListener("change", () => dirty.add(field));
  }

  async function renderState(): Promise<void> {
    const state = await window.settingsApi.getState();
    if (!dirty.has(daySelect)) {
      fillOptions(daySelect, monthDays, state.resetDay, "Choose a day");
    }
    if (!dirty.has(resetTime.hour) && !dirty.has(resetTime.minute)) {
      fillTime(resetTime, state.resetTime);
    }
    if (!dirty.has(weekdaySelect)) {
      fillOptions(weekdaySelect, weekdays, state.weekResetDay);
    }
    if (!dirty.has(weekResetTime.hour) && !dirty.has(weekResetTime.minute)) {
      fillTime(weekResetTime, state.weekResetTime);
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
    if (!Number.isInteger(weekResetDay) || weekResetDay < 0 || weekResetDay > 6) {
      weekdaySelect.reportValidity();
      return;
    }
    saveButton.disabled = true;
    void window.settingsApi
      .saveSettings({
        resetDay,
        resetTime: readTime(resetTime),
        weekResetDay,
        weekResetTime: readTime(weekResetTime),
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
