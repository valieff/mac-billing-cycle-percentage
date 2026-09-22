import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cycleProgress } from "./cycle.js";

function on(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0);
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

describe("cycleProgress", () => {
  it("counts 3 of 30 days on 17 September 2026 when the reset is the 15th", () => {
    const progress = cycleProgress(on(2026, 9, 17), 15);
    assert.equal(iso(progress.start), "2026-09-15");
    assert.equal(iso(progress.nextReset), "2026-10-15");
    assert.equal(progress.elapsedDays, 3);
    assert.equal(progress.totalDays, 30);
    assert.equal(progress.percent, 10);
  });

  it("uses the local calendar date late in the evening", () => {
    const progress = cycleProgress(on(2026, 9, 17, 23), 15);
    assert.equal(progress.elapsedDays, 3);
    assert.equal(progress.percent, 10);
  });

  it("treats the reset day as day 1 of the new cycle", () => {
    const progress = cycleProgress(on(2026, 9, 15), 15);
    assert.equal(progress.elapsedDays, 1);
    assert.equal(progress.totalDays, 30);
    assert.equal(progress.percent, 3);
  });

  it("shows 100% on the last day before the next reset", () => {
    const progress = cycleProgress(on(2026, 10, 14), 15);
    assert.equal(iso(progress.start), "2026-09-15");
    assert.equal(iso(progress.nextReset), "2026-10-15");
    assert.equal(progress.elapsedDays, 30);
    assert.equal(progress.totalDays, 30);
    assert.equal(progress.percent, 100);
  });

  it("starts the following cycle on the reset day", () => {
    const progress = cycleProgress(on(2026, 10, 15), 15);
    assert.equal(iso(progress.start), "2026-10-15");
    assert.equal(iso(progress.nextReset), "2026-11-15");
    assert.equal(progress.elapsedDays, 1);
    assert.equal(progress.totalDays, 31);
    assert.equal(progress.percent, 3);
  });

  it("keeps a day before this month's reset in the previous cycle", () => {
    const progress = cycleProgress(on(2026, 9, 14), 15);
    assert.equal(iso(progress.start), "2026-08-15");
    assert.equal(iso(progress.nextReset), "2026-09-15");
    assert.equal(progress.elapsedDays, 31);
    assert.equal(progress.totalDays, 31);
    assert.equal(progress.percent, 100);
  });

  it("clamps a 31st reset to 28 February 2026 and ends the January cycle on the 27th", () => {
    const progress = cycleProgress(on(2026, 2, 27), 31);
    assert.equal(iso(progress.start), "2026-01-31");
    assert.equal(iso(progress.nextReset), "2026-02-28");
    assert.equal(progress.elapsedDays, 28);
    assert.equal(progress.totalDays, 28);
    assert.equal(progress.percent, 100);
  });

  it("starts a new cycle on 28 February 2026 when the reset is the 31st", () => {
    const progress = cycleProgress(on(2026, 2, 28), 31);
    assert.equal(iso(progress.start), "2026-02-28");
    assert.equal(iso(progress.nextReset), "2026-03-31");
    assert.equal(progress.elapsedDays, 1);
    assert.equal(progress.totalDays, 31);
    assert.equal(progress.percent, 3);
  });

  it("ends the March cycle on 29 April when the reset is the 31st", () => {
    const progress = cycleProgress(on(2026, 4, 29), 31);
    assert.equal(iso(progress.start), "2026-03-31");
    assert.equal(iso(progress.nextReset), "2026-04-30");
    assert.equal(progress.elapsedDays, 30);
    assert.equal(progress.totalDays, 30);
    assert.equal(progress.percent, 100);
  });

  it("starts the next cycle on 30 April when the reset is the 31st", () => {
    const progress = cycleProgress(on(2026, 4, 30), 31);
    assert.equal(iso(progress.start), "2026-04-30");
    assert.equal(iso(progress.nextReset), "2026-05-31");
    assert.equal(progress.elapsedDays, 1);
    assert.equal(progress.totalDays, 31);
    assert.equal(progress.percent, 3);
  });

  it("clamps a 31st reset to 29 February in a leap year", () => {
    const lastDay = cycleProgress(on(2028, 2, 28), 31);
    assert.equal(iso(lastDay.start), "2028-01-31");
    assert.equal(iso(lastDay.nextReset), "2028-02-29");
    assert.equal(lastDay.percent, 100);

    const resetDay = cycleProgress(on(2028, 2, 29), 31);
    assert.equal(iso(resetDay.start), "2028-02-29");
    assert.equal(iso(resetDay.nextReset), "2028-03-31");
    assert.equal(resetDay.elapsedDays, 1);
    assert.equal(resetDay.totalDays, 31);
  });

  it("rejects a reset day outside 1 through 31", () => {
    assert.throws(() => cycleProgress(on(2026, 9, 17), 0), /1 to 31/);
    assert.throws(() => cycleProgress(on(2026, 9, 17), 32), /1 to 31/);
    assert.throws(() => cycleProgress(on(2026, 9, 17), 15.5), /1 to 31/);
  });
});
