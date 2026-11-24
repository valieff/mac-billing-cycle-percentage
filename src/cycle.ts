export interface PeriodProgress {
  /** Share of the period already gone, from 0 to 1. */
  fraction: number;
  /** Whole percent of the period already gone, rounded down. */
  percent: number;
}

/** How far `now` is through the period from `start` to `end` (epoch milliseconds). */
export function progressBetween(now: number, start: number, end: number): PeriodProgress {
  if (!(end > start)) {
    throw new Error(`A period must end after it starts, received ${start} to ${end}`);
  }
  const fraction = Math.min(1, Math.max(0, (now - start) / (end - start)));
  return { fraction, percent: Math.floor(fraction * 100) };
}
