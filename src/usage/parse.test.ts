import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { describe, it } from "node:test";
import {
  cursorEncryptedPrefix,
  decryptCursorToken,
  jwtExpiry,
  parseClaudeCredentials,
  parseClaudeUsage,
  parseCursorUsage,
  rollForward,
  unquote,
  weekMs,
} from "./parse.js";

// Trimmed from a real answer on 2026-11-24.
const claudeAnswer = {
  five_hour: { utilization: 24.0, resets_at: "2026-11-24T16:10:00.192479+00:00" },
  seven_day: { utilization: 14.0, resets_at: "2026-11-29T14:00:00.192499+00:00" },
  seven_day_opus: null,
  limits: [
    { kind: "session", percent: 24, resets_at: "2026-11-24T16:10:00.192479+00:00" },
    { kind: "weekly_all", percent: 14, resets_at: "2026-11-29T14:00:00.192499+00:00" },
  ],
};

// Trimmed from a real answer on 2026-11-24.
const cursorAnswer = {
  billingCycleStart: "1795179822161",
  billingCycleEnd: "1795784622161",
  planUsage: { remainingBonus: false, autoPercentUsed: 16.145801101553314, totalPercentUsed: 16.145801101553314 },
  spendLimitUsage: { limitType: "user" },
  enabled: true,
};

describe("parseClaudeUsage", () => {
  it("reads the seven-day limit and derives the week from its reset", () => {
    const usage = parseClaudeUsage(claudeAnswer);
    const end = Date.parse("2026-11-29T14:00:00.192Z");
    assert.deepEqual(usage, { usedPercent: 14, windowStart: end - weekMs, windowEnd: end });
  });

  it("falls back to the weekly_all entry in limits", () => {
    const usage = parseClaudeUsage({ ...claudeAnswer, seven_day: null });
    assert.equal(usage?.usedPercent, 14);
    assert.equal(usage?.windowEnd, Date.parse("2026-11-29T14:00:00.192Z"));
  });

  it("accepts a reset given in epoch seconds", () => {
    const usage = parseClaudeUsage({ seven_day: { utilization: 3, resets_at: 1_795_000_000 } });
    assert.equal(usage?.windowEnd, 1_795_000_000_000);
  });

  it("returns null when no weekly limit is reported", () => {
    assert.equal(parseClaudeUsage({ five_hour: { utilization: 5 }, seven_day: null }), null);
    assert.equal(parseClaudeUsage("nope"), null);
  });
});

describe("parseCursorUsage", () => {
  it("reads the weekly window and the total percent used", () => {
    assert.deepEqual(parseCursorUsage(cursorAnswer), {
      usedPercent: 16.145801101553314,
      windowStart: 1795179822161,
      windowEnd: 1795784622161,
    });
  });

  it("treats a missing percent as zero, as proto3 JSON leaves zeros out", () => {
    const usage = parseCursorUsage({ ...cursorAnswer, planUsage: {} });
    assert.equal(usage?.usedPercent, 0);
  });

  it("falls back to autoPercentUsed", () => {
    const usage = parseCursorUsage({ ...cursorAnswer, planUsage: { autoPercentUsed: 40 } });
    assert.equal(usage?.usedPercent, 40);
  });

  it("returns null when usage is not enabled for the plan", () => {
    assert.equal(parseCursorUsage({ ...cursorAnswer, enabled: false }), null);
    assert.equal(parseCursorUsage({ enabled: true }), null);
  });

  it("drops a window that does not move forward", () => {
    const usage = parseCursorUsage({ ...cursorAnswer, billingCycleEnd: cursorAnswer.billingCycleStart });
    assert.equal(usage?.windowStart, null);
    assert.equal(usage?.windowEnd, null);
  });
});

describe("parseClaudeCredentials", () => {
  it("reads the access token and expiry", () => {
    const text = JSON.stringify({ claudeAiOauth: { accessToken: "abc", refreshToken: "def", expiresAt: 1_800_000_000_000 } });
    assert.deepEqual(parseClaudeCredentials(text), { accessToken: "abc", expiresAt: 1_800_000_000_000 });
  });

  it("returns null for anything else", () => {
    assert.equal(parseClaudeCredentials("{}"), null);
    assert.equal(parseClaudeCredentials("not json"), null);
  });
});

function sealLikeElectron(plain: string, password: string): string {
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  const blob = Buffer.concat([Buffer.from("v10"), cipher.update(plain, "utf8"), cipher.final()]);
  return cursorEncryptedPrefix + blob.toString("base64");
}

describe("decryptCursorToken", () => {
  it("opens a login sealed the way Cursor seals it", () => {
    assert.equal(decryptCursorToken(sealLikeElectron("header.payload.signature", "secret"), "secret"), "header.payload.signature");
  });

  it("fails with the wrong password", () => {
    assert.throws(() => decryptCursorToken(sealLikeElectron("header.payload.signature", "secret"), "other"));
  });

  it("rejects values that are not encrypted", () => {
    assert.throws(() => decryptCursorToken("header.payload.signature", "secret"));
  });
});

describe("jwtExpiry", () => {
  it("reads exp in milliseconds", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString("base64url");
    assert.equal(jwtExpiry(`e30.${payload}.sig`), 1_800_000_000_000);
  });

  it("returns null for tokens that are not JWTs", () => {
    assert.equal(jwtExpiry("opaque"), null);
    assert.equal(jwtExpiry("a.%%%.c"), null);
  });
});

describe("unquote", () => {
  it("removes JSON string quotes only", () => {
    assert.equal(unquote('"abc"'), "abc");
    assert.equal(unquote("abc"), "abc");
  });
});

describe("rollForward", () => {
  const usage = { usedPercent: 50, windowStart: 0, windowEnd: weekMs };

  it("keeps a window that still contains now", () => {
    assert.equal(rollForward(usage, weekMs - 1), usage);
  });

  it("moves a past window forward by whole weeks and forgets its usage", () => {
    assert.deepEqual(rollForward(usage, 2 * weekMs + 5), {
      usedPercent: null,
      windowStart: 2 * weekMs,
      windowEnd: 3 * weekMs,
    });
  });
});
