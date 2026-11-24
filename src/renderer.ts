type ProviderId = "claude" | "cursor";

interface ProviderView {
  id: ProviderId;
  name: string;
  status: "off" | "ok" | "stale" | "attention";
  message: string | null;
  action: "reconnect" | null;
  usedFraction: number | null;
  usedPercent: number | null;
  elapsedFraction: number | null;
  elapsedPercent: number | null;
  windowEnd: number | null;
  fetchedAt: number | null;
  busy: boolean;
}

interface AppState {
  openAtLogin: boolean;
  claudeEnabled: boolean;
  cursorEnabled: boolean;
  onboarded: boolean;
  providers: ProviderView[];
  menuBarClipped: boolean;
}

interface ConnectResult {
  ok: boolean;
  message: string | null;
}

interface PanelApi {
  getState: () => Promise<AppState>;
  connect: (provider: ProviderId) => Promise<ConnectResult>;
  disconnect: (provider: ProviderId) => Promise<void>;
  refresh: () => Promise<void>;
  setOpenAtLogin: (openAtLogin: boolean) => Promise<void>;
  finishOnboarding: () => Promise<void>;
  resize: (height: number) => Promise<void>;
  quit: () => Promise<void>;
  onDidShow: (listener: () => void) => void;
  onStateChanged: (listener: () => void) => void;
}

declare global {
  interface Window {
    panelApi: PanelApi;
  }
}

/** What each provider reads and where it sends it, shown before the user connects. */
const connectCopy: Record<ProviderId, string> = {
  claude:
    "Reads the login Claude Code saved in your Keychain and sends it only to api.anthropic.com to get your weekly usage. macOS won't ask for anything.",
  cursor:
    "Cursor encrypts its login, so macOS will ask once for “Cursor Safe Storage”. Click Allow, not Always Allow. The login is then kept encrypted by this app and sent only to api2.cursor.sh.",
};

const resetFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Connect attempts in progress and their last error, kept across re-renders. */
const connecting = new Set<ProviderId>();
const connectErrors = new Map<ProviderId, string>();

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className !== undefined) {
    element.className = props.className;
  }
  if (props.text !== undefined) {
    element.textContent = props.text;
  }
  element.append(...children);
  return element;
}

function button(text: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const element = el("button", { className, text });
  element.type = "button";
  element.disabled = disabled;
  element.addEventListener("click", onClick);
  return element;
}

function barRow(label: string, kind: "used" | "week", fraction: number | null, percent: number | null) {
  const fill = el("span");
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction ?? 0)) * 1000) / 10}%`;
  const bar = el("div", { className: `bar ${kind}` }, fill);
  bar.setAttribute("role", "meter");
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  if (percent !== null) {
    bar.setAttribute("aria-valuenow", String(percent));
  }
  return el(
    "div",
    { className: "bar-row" },
    el("span", { className: "muted", text: label }),
    bar,
    el("span", { className: "value", text: percent === null ? "–" : `${percent}%` }),
  );
}

function paceText(view: ProviderView): string | null {
  const parts: string[] = [];
  if (view.windowEnd !== null) {
    parts.push(`Resets ${resetFormat.format(view.windowEnd)}`);
  }
  if (view.usedPercent !== null && view.elapsedPercent !== null) {
    const difference = view.usedPercent - view.elapsedPercent;
    parts.push(
      difference === 0 ? "on pace" : `${Math.abs(difference)} pts ${difference > 0 ? "over" : "under"} pace`,
    );
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

function connect(id: ProviderId, rerender: () => void): void {
  connecting.add(id);
  connectErrors.delete(id);
  rerender();
  void window.panelApi
    .connect(id)
    .then((result) => {
      if (!result.ok && result.message !== null) {
        connectErrors.set(id, result.message);
      }
    })
    .catch(() => {
      connectErrors.set(id, "Could not connect. Try again.");
    })
    .finally(() => {
      connecting.delete(id);
      rerender();
    });
}

function renderProvider(section: HTMLElement, view: ProviderView, rerender: () => void): void {
  const isConnecting = connecting.has(view.id);

  if (view.status === "off") {
    const error = connectErrors.get(view.id);
    section.replaceChildren(
      el("h2", { text: view.name }),
      el("p", { className: "muted", text: connectCopy[view.id] }),
      button(
        isConnecting ? (view.id === "cursor" ? "Waiting for macOS…" : "Connecting…") : `Connect ${view.name}`,
        "primary",
        () => connect(view.id, rerender),
        isConnecting,
      ),
      ...(error === undefined ? [] : [el("p", { className: "status error", text: error })]),
    );
    return;
  }

  const over =
    view.usedPercent !== null && view.elapsedPercent !== null && view.usedPercent > view.elapsedPercent;
  const pace = paceText(view);
  const children: Node[] = [
    el(
      "h2",
      {},
      el("span", { text: view.name }),
      button("Disconnect", "link", () => {
        connectErrors.delete(view.id);
        void window.panelApi.disconnect(view.id);
      }),
    ),
    barRow("Used", "used", view.usedFraction, view.usedPercent),
    barRow("Week", "week", view.elapsedFraction, view.elapsedPercent),
  ];
  if (pace !== null) {
    children.push(el("p", { className: over ? "pace over" : "pace muted", text: pace }));
  }
  const error = connectErrors.get(view.id);
  if (view.status !== "ok" && view.message !== null) {
    const status = el("p", { className: `status${view.status === "attention" ? " error" : ""}`, text: view.message });
    children.push(status);
  }
  if (view.action === "reconnect") {
    children.push(
      button(isConnecting ? "Waiting for macOS…" : `Reconnect ${view.name}`, "primary", () => connect(view.id, rerender), isConnecting),
    );
    if (error !== undefined) {
      children.push(el("p", { className: "status error", text: error }));
    }
  }
  section.replaceChildren(...children);
}

function updatedText(state: AppState): string {
  const times = state.providers.filter((view) => view.status !== "off").map((view) => view.fetchedAt ?? 0);
  if (times.length === 0) {
    return "";
  }
  const latest = Math.max(...times);
  if (latest === 0) {
    return "Not updated yet";
  }
  const minutes = Math.floor((Date.now() - latest) / 60_000);
  if (minutes < 1) {
    return "Updated just now";
  }
  if (minutes < 60) {
    return `Updated ${minutes} min ago`;
  }
  return `Updated ${resetFormat.format(latest)}`;
}

async function init(): Promise<void> {
  const panel = requireElement("panel", HTMLElement);
  const welcome = requireElement("welcome", HTMLParagraphElement);
  const clipped = requireElement("clipped", HTMLParagraphElement);
  const updated = requireElement("updated", HTMLParagraphElement);
  const openAtLogin = requireElement("open-at-login", HTMLInputElement);
  const refreshButton = requireElement("refresh", HTMLButtonElement);
  const doneButton = requireElement("done", HTMLButtonElement);
  const quitButton = requireElement("quit", HTMLButtonElement);
  const sections: Record<ProviderId, HTMLElement> = {
    claude: requireElement("provider-claude", HTMLElement),
    cursor: requireElement("provider-cursor", HTMLElement),
  };

  let rendering = Promise.resolve();
  const render = (): void => {
    rendering = rendering.then(async () => {
      const state = await window.panelApi.getState();
      welcome.hidden = state.onboarded;
      doneButton.hidden = state.onboarded;
      clipped.hidden = !state.menuBarClipped;
      openAtLogin.checked = state.openAtLogin;
      for (const view of state.providers) {
        renderProvider(sections[view.id], view, render);
      }
      const anyConnected = state.providers.some((view) => view.status !== "off");
      refreshButton.hidden = !anyConnected;
      refreshButton.disabled = state.providers.some((view) => view.busy);
      refreshButton.textContent = refreshButton.disabled ? "Refreshing…" : "Refresh";
      updated.textContent = updatedText(state);
      updated.hidden = updated.textContent === "";
      const style = getComputedStyle(document.body);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      await window.panelApi.resize(Math.ceil(panel.getBoundingClientRect().height + padding));
    }).catch((error: unknown) => {
      console.error("Could not render the panel", error);
    });
  };

  render();
  window.panelApi.onDidShow(render);
  window.panelApi.onStateChanged(render);
  setInterval(render, 30_000);

  refreshButton.addEventListener("click", () => {
    void window.panelApi.refresh();
  });
  openAtLogin.addEventListener("change", () => {
    void window.panelApi.setOpenAtLogin(openAtLogin.checked);
  });
  doneButton.addEventListener("click", () => {
    void window.panelApi.finishOnboarding().then(render);
  });
  quitButton.addEventListener("click", () => {
    void window.panelApi.quit();
  });
}

void init();

export {};
