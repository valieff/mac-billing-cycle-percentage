import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { progressBetween } from "./cycle.js";

const hour = 60 * 60 * 1000;

describe("progressBetween", () => {
  it("measures the share of the period gone and rounds the percent down", () => {
    const progress = progressBetween(1_000 + 77.9 * hour, 1_000, 1_000 + 100 * hour);
    assert.ok(Math.abs(progress.fraction - 0.779) < 1e-9);
    assert.equal(progress.percent, 77);
  });

  it("clamps to the period", () => {
    assert.deepEqual(progressBetween(0, 10, 20), { fraction: 0, percent: 0 });
    assert.deepEqual(progressBetween(30, 10, 20), { fraction: 1, percent: 100 });
  });

  it("rejects a period that does not move forward", () => {
    assert.throws(() => progressBetween(5, 10, 10));
  });
});
