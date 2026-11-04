export interface TimeOfDay {
  hour: number;
  minute: number;
}

export interface PeriodProgress {
  start: Date;
  end: Date;
  /** Share of the period already gone, from 0 up to (but not including) 1. */
  fraction: number;
  /** Whole percent of the period already gone, rounded down. */
  percent: number;
}

export const midnight: TimeOfDay = { hour: 0, minute: 0 };

/**
 * Progress through a monthly billing cycle that resets on `resetDay` at `resetTime`, local time.
 * Months without that day reset on their last day.
 */
export function monthProgress(now: Date, resetDay: number, resetTime: TimeOfDay = midnight): PeriodProgress {
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) {
    throw new Error(`Reset day must be an integer from 1 to 31, received ${resetDay}`);
  }
  assertTime(resetTime);

  const year = now.getFullYear();
  const month = now.getMonth();
  const thisReset = monthlyReset(year, month, resetDay, resetTime);

  if (now.getTime() >= thisReset.getTime()) {
    return progressBetween(now, thisReset, monthlyReset(year, month + 1, resetDay, resetTime));
  }
  return progressBetween(now, monthlyReset(year, month - 1, resetDay, resetTime), thisReset);
}

/**
 * Progress through a week that starts on `resetWeekday` (0 = Sunday … 6 = Saturday) at `resetTime`, local time.
 */
export function weekProgress(now: Date, resetWeekday: number, resetTime: TimeOfDay = midnight): PeriodProgress {
  if (!Number.isInteger(resetWeekday) || resetWeekday < 0 || resetWeekday > 6) {
    throw new Error(`Reset weekday must be an integer from 0 to 6, received ${resetWeekday}`);
  }
  assertTime(resetTime);

  const daysBack = (now.getDay() - resetWeekday + 7) % 7;
  let start = atTime(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, resetTime);
  if (start.getTime() > now.getTime()) {
    start = atTime(now.getFullYear(), now.getMonth(), now.getDate() - daysBack - 7, resetTime);
  }
  const end = atTime(start.getFullYear(), start.getMonth(), start.getDate() + 7, resetTime);
  return progressBetween(now, start, end);
}

export function parseTimeOfDay(value: string): TimeOfDay | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) {
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function progressBetween(now: Date, start: Date, end: Date): PeriodProgress {
  const fraction = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
  return {
    start,
    end,
    fraction,
    percent: Math.min(100, Math.max(0, Math.floor(fraction * 100))),
  };
}

function monthlyReset(year: number, month: number, resetDay: number, time: TimeOfDay): Date {
  const first = new Date(year, month, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return atTime(first.getFullYear(), first.getMonth(), Math.min(resetDay, lastDay), time);
}

function atTime(year: number, month: number, day: number, time: TimeOfDay): Date {
  return new Date(year, month, day, time.hour, time.minute, 0, 0);
}

function assertTime(time: TimeOfDay): void {
  const valid =
    Number.isInteger(time.hour) &&
    Number.isInteger(time.minute) &&
    time.hour >= 0 &&
    time.hour <= 23 &&
    time.minute >= 0 &&
    time.minute <= 59;
  if (!valid) {
    throw new Error(`Reset time must be a valid hour and minute, received ${JSON.stringify(time)}`);
  }
}
