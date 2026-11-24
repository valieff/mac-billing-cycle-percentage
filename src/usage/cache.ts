import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { providerIds, type ProviderId, type Usage } from "./types.js";

export interface CachedReading {
  usage: Usage;
  fetchedAt: number;
}

export type ReadingCache = Partial<Record<ProviderId, CachedReading>>;

function cachePath(): string {
  return path.join(app.getPath("userData"), "usage-cache.json");
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The last good reading per provider, so the bars survive restarts and outages. */
export function loadCache(): ReadingCache {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const cache: ReadingCache = {};
    for (const id of providerIds) {
      const entry = (parsed as Record<string, unknown>)[id];
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const usage = (typeof record.usage === "object" && record.usage !== null ? record.usage : {}) as Record<
        string,
        unknown
      >;
      const fetchedAt = numberOrNull(record.fetchedAt);
      if (fetchedAt === null) {
        continue;
      }
      const windowStart = numberOrNull(usage.windowStart);
      const windowEnd = numberOrNull(usage.windowEnd);
      // A window that doesn't move forward can't be drawn, so drop it rather than fail later.
      const validWindow = windowStart !== null && windowEnd !== null && windowEnd > windowStart;
      cache[id] = {
        fetchedAt,
        usage: {
          usedPercent: numberOrNull(usage.usedPercent),
          windowStart: validWindow ? windowStart : null,
          windowEnd: validWindow ? windowEnd : null,
        },
      };
    }
    return cache;
  } catch {
    return {};
  }
}

export function saveCache(cache: ReadingCache): void {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(cachePath(), `${JSON.stringify(cache, null, 2)}\n`);
  } catch (error) {
    console.error("Could not save the usage cache", error);
  }
}
