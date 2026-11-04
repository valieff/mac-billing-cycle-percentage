import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { monthProgress, parseTimeOfDay, weekProgress } from "./cycle.js";

function at(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0);
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const nine = { hour: 9, minute: 0 };

describe("monthProgress", () => {
  it("measures the exact time since a midnight reset", () => {
    const progress = monthProgress(at(2026, 9, 18, 0), 15);
    assert.equal(stamp(progress.start), "2026-09-15 00:00");
    assert.equal(stamp(progress.end), "2026-10-15 00:00");
    // 3 of 30 days; a DST change inside the cycle moves this by an hour at most.
    assert.ok(Math.abs(progress.fraction - 3 / 30) < 1 / (30 * 24));
    assert.equal(progress.percent, 10);
  });

  it("counts the time of day, not whole days", () => {
    assert.equal(monthProgress(at(2026, 9, 18, 0), 15).percent, 10);
    assert.equal(monthProgress(at(2026, 9, 18, 18), 15).percent, 12);
  });

  it("stays in the previous cycle until the reset time on the reset day", () => {
    const before = monthProgress(at(2026, 10, 15, 8, 59), 15, nine);
    assert.equal(stamp(before.start), "2026-09-15 09:00");
    assert.equal(stamp(before.end), "2026-10-15 09:00");
    assert.equal(before.percent, 99);

    const after = monthProgress(at(2026, 10, 15, 9, 0), 15, nine);
    assert.equal(stamp(after.start), "2026-10-15 09:00");
    assert.equal(stamp(after.end), "2026-11-15 09:00");
    assert.equal(after.percent, 0);
  });

  it("keeps a day before this month's reset in the previous cycle", () => {
    const progress = monthProgress(at(2026, 9, 14), 15);
    assert.equal(stamp(progress.start), "2026-08-15 00:00");
    assert.equal(stamp(progress.end), "2026-09-15 00:00");
  });

  it("crosses the year boundary", () => {
    const progress = monthProgress(at(2027, 1, 3), 20, nine);
    assert.equal(stamp(progress.start), "2026-12-20 09:00");
    assert.equal(stamp(progress.end), "2027-01-20 09:00");
  });

  it("clamps a 31st reset to the last day of shorter months", () => {
    const february = monthProgress(at(2026, 2, 27), 31, nine);
    assert.equal(stamp(february.start), "2026-01-31 09:00");
    assert.equal(stamp(february.end), "2026-02-28 09:00");

    const april = monthProgress(at(2026, 4, 30, 10), 31, nine);
    assert.equal(stamp(april.start), "2026-04-30 09:00");
    assert.equal(stamp(april.end), "2026-05-31 09:00");
  });

  it("clamps a 31st reset to 29 February in a leap year", () => {
    const progress = monthProgress(at(2028, 2, 29, 1), 31);
    assert.equal(stamp(progress.start), "2028-02-29 00:00");
    assert.equal(stamp(progress.end), "2028-03-31 00:00");
  });

  it("rejects a reset day outside 1 through 31", () => {
    assert.throws(() => monthProgress(at(2026, 9, 17), 0), /1 to 31/);
    assert.throws(() => monthProgress(at(2026, 9, 17), 32), /1 to 31/);
    assert.throws(() => monthProgress(at(2026, 9, 17), 15.5), /1 to 31/);
  });

  it("rejects an invalid reset time", () => {
    assert.throws(() => monthProgress(at(2026, 9, 17), 15, { hour: 24, minute: 0 }), /hour and minute/);
  });
});

describe("weekProgress", () => {
  // 4 November 2026 is a Wednesday.
  it("measures from Monday midnight by default", () => {
    const progress = weekProgress(at(2026, 11, 4, 12), 1);
    assert.equal(stamp(progress.start), "2026-11-02 00:00");
    assert.equal(stamp(progress.end), "2026-11-09 00:00");
    assert.equal(progress.fraction, 2.5 / 7);
    assert.equal(progress.percent, 35);
  });

  it("starts a new week exactly at the reset time", () => {
    const before = weekProgress(at(2026, 11, 9, 8, 59), 1, nine);
    assert.equal(stamp(before.start), "2026-11-02 09:00");
    assert.equal(before.percent, 99);

    const after = weekProgress(at(2026, 11, 9, 9, 0), 1, nine);
    assert.equal(stamp(after.start), "2026-11-09 09:00");
    assert.equal(stamp(after.end), "2026-11-16 09:00");
    assert.equal(after.percent, 0);
  });

  it("handles a reset later in the week than today", () => {
    const progress = weekProgress(at(2026, 11, 4, 12), 5, nine);
    assert.equal(stamp(progress.start), "2026-10-30 09:00");
    assert.equal(stamp(progress.end), "2026-11-06 09:00");
  });

  it("handles a Sunday reset across a month boundary", () => {
    const progress = weekProgress(at(2026, 12, 1, 12), 0);
    assert.equal(stamp(progress.start), "2026-11-29 00:00");
    assert.equal(stamp(progress.end), "2026-12-06 00:00");
  });

  it("rejects a weekday outside 0 through 6", () => {
    assert.throws(() => weekProgress(at(2026, 11, 4), 7), /0 to 6/);
    assert.throws(() => weekProgress(at(2026, 11, 4), -1), /0 to 6/);
  });
});

describe("parseTimeOfDay", () => {
  it("reads 24-hour HH:MM", () => {
    assert.deepEqual(parseTimeOfDay("00:00"), { hour: 0, minute: 0 });
    assert.deepEqual(parseTimeOfDay("09:30"), { hour: 9, minute: 30 });
    assert.deepEqual(parseTimeOfDay("23:59"), { hour: 23, minute: 59 });
  });

  it("rejects anything else", () => {
    assert.equal(parseTimeOfDay("24:00"), null);
    assert.equal(parseTimeOfDay("9:30"), null);
    assert.equal(parseTimeOfDay("09:60"), null);
    assert.equal(parseTimeOfDay(""), null);
  });
});
