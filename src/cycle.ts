export interface CycleProgress {
  resetDay: number;
  start: Date;
  nextReset: Date;
  elapsedDays: number;
  totalDays: number;
  percent: number;
}

export function cycleProgress(today: Date, resetDay: number): CycleProgress {
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) {
    throw new Error(`Reset day must be an integer from 1 to 31, received ${resetDay}`);
  }

  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  const thisReset = effectiveReset(year, month, resetDay);

  const startMonth = day >= thisReset ? { year, month } : shiftMonth(year, month, -1);
  const nextMonth = day >= thisReset ? shiftMonth(year, month, 1) : { year, month };

  const start = calendarDate(
    startMonth.year,
    startMonth.month,
    effectiveReset(startMonth.year, startMonth.month, resetDay),
  );
  const nextReset = calendarDate(
    nextMonth.year,
    nextMonth.month,
    effectiveReset(nextMonth.year, nextMonth.month, resetDay),
  );
  const totalDays = daysBetween(start, nextReset);
  const elapsedDays = daysBetween(start, calendarDate(year, month, day)) + 1;

  return {
    resetDay,
    start,
    nextReset,
    elapsedDays,
    totalDays,
    percent: Math.round((elapsedDays / totalDays) * 100),
  };
}

function effectiveReset(year: number, month: number, resetDay: number): number {
  return Math.min(resetDay, lastDayOfMonth(year, month));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const shifted = new Date(year, month + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

function calendarDate(year: number, month: number, day: number): Date {
  return new Date(year, month, day);
}

function daysBetween(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
}
