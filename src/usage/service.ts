import { progressBetween } from "../cycle.js";
import { loadCache, saveCache, type ReadingCache } from "./cache.js";
import { fetchClaudeUsage } from "./claude.js";
import { connectCursor, fetchCursorUsage, forgetCursorToken } from "./cursor.js";
import { rollForward } from "./parse.js";
import {
  providerIds,
  providerNames,
  type FetchResult,
  type Meter,
  type ProviderAction,
  type ProviderId,
  type ProviderStatus,
} from "./types.js";

const pollMs = 5 * 60_000;
const maxBackoffMs = 30 * 60_000;
/** Opening the panel refreshes readings older than this. */
const freshMs = 60_000;

/** One limit, ready to draw: how much is used and how much of its window has passed. */
export interface MeterView {
  /** 0–1, or null when unknown. */
  usedFraction: number | null;
  usedPercent: number | null;
  elapsedFraction: number | null;
  elapsedPercent: number | null;
  windowEnd: number | null;
}

export interface DetailView extends MeterView {
  label: string;
  showElapsed: boolean;
  timeLabel: string;
}

/** What the tray and the panel need to draw one provider. The top level is the weekly limit. */
export interface ProviderView extends MeterView {
  id: ProviderId;
  name: string;
  status: ProviderStatus;
  message: string | null;
  action: ProviderAction;
  details: DetailView[];
  fetchedAt: number | null;
  busy: boolean;
}

function meterView(meter: Meter | null, now: number): MeterView {
  const hasWindow = meter !== null && meter.windowStart !== null && meter.windowEnd !== null;
  const elapsed = hasWindow ? progressBetween(now, meter.windowStart as number, meter.windowEnd as number) : null;
  const used = meter?.usedPercent ?? null;
  return {
    usedFraction: used === null ? null : used / 100,
    usedPercent: used === null ? null : Math.floor(used),
    elapsedFraction: elapsed?.fraction ?? null,
    elapsedPercent: elapsed?.percent ?? null,
    windowEnd: hasWindow ? meter.windowEnd : null,
  };
}

interface ProviderState {
  status: ProviderStatus;
  message: string | null;
  action: ProviderAction;
  nextFetchAt: number;
  failures: number;
  inFlight: Promise<FetchResult> | null;
  /** Bumped by disconnect, so a request that was already running can't bring the provider back. */
  generation: number;
}

export class UsageService {
  private readonly cache: ReadingCache = loadCache();
  private readonly states: Record<ProviderId, ProviderState>;

  constructor(
    private readonly isEnabled: (id: ProviderId) => boolean,
    private readonly onChange: () => void,
  ) {
    const initial = (id: ProviderId): ProviderState => ({
      status: isEnabled(id) ? "ok" : "off",
      message: null,
      action: null,
      nextFetchAt: 0,
      failures: 0,
      inFlight: null,
      generation: 0,
    });
    this.states = { claude: initial("claude"), cursor: initial("cursor") };
  }

  views(now = Date.now()): ProviderView[] {
    return providerIds.map((id) => this.view(id, now));
  }

  /** Fetches every enabled provider whose next fetch is due. */
  refreshDue(now = Date.now()): void {
    for (const id of providerIds) {
      if (this.isEnabled(id) && now >= this.states[id].nextFetchAt) {
        void this.fetch(id);
      }
    }
  }

  /**
   * Fetches readings older than a minute, for when the panel opens or the Mac wakes. A provider that
   * is backing off after failures keeps waiting.
   */
  refreshStale(now = Date.now()): void {
    for (const id of providerIds) {
      const state = this.states[id];
      const fetchedAt = this.cache[id]?.fetchedAt ?? 0;
      const backingOff = state.failures > 0 && now < state.nextFetchAt;
      if (this.isEnabled(id) && !backingOff && now - fetchedAt >= freshMs) {
        void this.fetch(id);
      }
    }
  }

  /** Fetches every enabled provider now, for the Refresh button. */
  refreshAll(): void {
    for (const id of providerIds) {
      if (this.isEnabled(id)) {
        void this.fetch(id);
      }
    }
  }

  /** Runs the provider's first-time connection. Only the user's click starts this. */
  async connect(id: ProviderId): Promise<FetchResult> {
    const state = this.states[id];
    if (state.inFlight !== null) {
      await state.inFlight;
    }
    return this.track(id, id === "claude" ? fetchClaudeUsage() : connectCursor());
  }

  async disconnect(id: ProviderId): Promise<void> {
    this.states[id].generation += 1;
    if (id === "cursor") {
      await forgetCursorToken();
    }
    delete this.cache[id];
    saveCache(this.cache);
    Object.assign(this.states[id], { status: "off", message: null, action: null, failures: 0, nextFetchAt: 0 });
    this.onChange();
  }

  private fetch(id: ProviderId): Promise<FetchResult> {
    const state = this.states[id];
    if (state.inFlight !== null) {
      return state.inFlight;
    }
    return this.track(id, id === "claude" ? fetchClaudeUsage() : fetchCursorUsage());
  }

  private track(id: ProviderId, request: Promise<FetchResult>): Promise<FetchResult> {
    const state = this.states[id];
    const generation = state.generation;
    const inFlight = request.then(async (result): Promise<FetchResult> => {
      if (state.generation !== generation) {
        // Disconnected while this was running: drop the reading and anything it saved.
        if (id === "cursor") {
          await forgetCursorToken();
        }
        return { kind: "fail", status: "attention", message: `${providerNames[id]} was disconnected.` };
      }
      this.apply(id, result);
      return result;
    });
    state.inFlight = inFlight;
    this.onChange();
    void inFlight.finally(() => {
      if (state.inFlight === inFlight) {
        state.inFlight = null;
        this.onChange();
      }
    });
    return inFlight;
  }

  private apply(id: ProviderId, result: FetchResult): void {
    const state = this.states[id];
    const now = Date.now();
    if (result.kind === "ok") {
      this.cache[id] = { usage: result.usage, fetchedAt: now };
      saveCache(this.cache);
      Object.assign(state, { status: "ok", message: null, action: null, failures: 0, nextFetchAt: now + pollMs });
      return;
    }
    state.failures = result.backoff ? state.failures + 1 : 0;
    const delay = result.backoff ? Math.min(maxBackoffMs, pollMs * 2 ** (state.failures - 1)) : pollMs;
    Object.assign(state, {
      status: this.isEnabled(id) ? result.status : "off",
      message: result.message,
      action: result.action ?? null,
      nextFetchAt: now + delay,
    });
  }

  private view(id: ProviderId, now: number): ProviderView {
    const state = this.states[id];
    const enabled = this.isEnabled(id);
    const cached = enabled ? this.cache[id] : undefined;
    const usage = cached === undefined ? null : rollForward(cached.usage, now);
    const week = meterView(usage, now);
    const cachedEnd = cached?.usage.windowEnd ?? null;

    let status: ProviderStatus = enabled ? state.status : "off";
    let message = enabled ? state.message : null;
    if (status === "ok" && week.usedPercent === null && cachedEnd !== null && now >= cachedEnd) {
      // The cached week ended and no new reading arrived yet.
      status = "stale";
      message = "A new week started. Waiting for a fresh reading.";
    }

    return {
      id,
      name: providerNames[id],
      status,
      message,
      action: enabled ? state.action : null,
      ...week,
      details: (usage?.details ?? []).map((detail) => ({
        ...meterView(detail, now),
        label: detail.label,
        showElapsed: detail.showElapsed,
        timeLabel: detail.timeLabel,
      })),
      fetchedAt: cached?.fetchedAt ?? null,
      busy: state.inFlight !== null,
    };
  }
}
