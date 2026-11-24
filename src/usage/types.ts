export type ProviderId = "claude" | "cursor";

export const providerIds: readonly ProviderId[] = ["claude", "cursor"];

export const providerNames: Record<ProviderId, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
};

/** Usage of one limit over one window. Times are epoch milliseconds. */
export interface Meter {
  /** Share of the limit used, 0–100, or null when the provider did not say. */
  usedPercent: number | null;
  windowStart: number | null;
  windowEnd: number | null;
}

/** An extra line in the panel, such as Claude's 5-hour session or Grok Bot's share of Cursor's week. */
export interface UsageDetail extends Meter {
  label: string;
  /** True when the panel draws a second bar for how much of the window has passed. */
  showElapsed: boolean;
  /** Label of that second bar, such as "Week" or "Time". */
  timeLabel: string;
}

/** One reading of a provider: its weekly limit, which the menu bar shows, plus panel-only details. */
export interface Usage extends Meter {
  details: UsageDetail[];
}

/**
 * - `off`: the user has not connected this provider.
 * - `ok`: the last fetch worked.
 * - `stale`: the last fetch failed for a reason that may fix itself; the cached reading is shown.
 * - `attention`: the user has to do something (see `message` and `action`).
 */
export type ProviderStatus = "off" | "ok" | "stale" | "attention";

export type ProviderAction = "reconnect" | null;

export type FetchResult =
  | { kind: "ok"; usage: Usage }
  | {
      kind: "fail";
      status: "stale" | "attention";
      message: string;
      action?: ProviderAction;
      /** True for rate limits and server errors, so the next try waits longer. */
      backoff?: boolean;
    };

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: "stale" | "attention",
    readonly action: ProviderAction = null,
    readonly backoff = false,
  ) {
    super(message);
  }

  toResult(): FetchResult {
    return { kind: "fail", status: this.status, message: this.message, action: this.action, backoff: this.backoff };
  }
}
