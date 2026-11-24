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
  parseGrokBotShare,
  rollForward,
  unquote,
  weekMs,
  withGrokBotSplit,
} from "./parse.js";

// Trimmed from a real answer on 2026-11-24.
const claudeAnswer = {
  five_hour: { utilization: 24.0, resets_at: "2026-11-24T16:10:00.192479+00:00" },
  seven_day: { utilization: 14.0, resets_at: "2026-11-29T14:00:00.192499+00:00" },
  seven_day_opus: null,
  limits: [
    { kind: "session", group: "session", percent: 24, resets_at: "2026-11-24T16:10:00.192479+00:00", scope: null },
    { kind: "weekly_all", group: "weekly", percent: 14, resets_at: "2026-11-29T14:00:00.192499+00:00", scope: null },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 13,
      resets_at: "2026-11-29T14:00:00.192681+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
    },
  ],
};

// Trimmed from a real answer on 2026-11-24 (bot ids removed).
const grokAnswer = {
  weeklyLimitPpm: {
    periodStartMs: "1795179822161",
    periodEndMs: "1795784622161",
    bySource: [
      { dayMs: "1795132800000", source: "GROK_BOT_USAGE_SOURCE_AUTOMATION", ppm: 3316 },
      { dayMs: "1795132800000", source: "GROK_BOT_USAGE_SOURCE_USER", ppm: 396 },
      { dayMs: "1795219200000", source: "GROK_BOT_USAGE_SOURCE_AUTOMATION", ppm: 14332 },
      { dayMs: "1795219200000", source: "GROK_BOT_USAGE_SOURCE_USER", ppm: 2505 },
      { dayMs: "1795305600000", source: "GROK_BOT_USAGE_SOURCE_AUTOMATION", ppm: 18903 },
      { dayMs: "1795305600000", source: "GROK_BOT_USAGE_SOURCE_USER", ppm: 2433 },
      { dayMs: "1795392000000", source: "GROK_BOT_USAGE_SOURCE_AUTOMATION", ppm: 35528 },
      { dayMs: "1795392000000", source: "GROK_BOT_USAGE_SOURCE_USER", ppm: 9201 },
      { dayMs: "1795478400000", source: "GROK_BOT_USAGE_SOURCE_AGENT", ppm: 12430 },
      { dayMs: "1795478400000", source: "GROK_BOT_USAGE_SOURCE_AUTOMATION", ppm: 20407 },
      { dayMs: "1795478400000", source: "GROK_BOT_USAGE_SOURCE_USER", ppm: 16449 },
    ],
    byBot: [{ dayMs: "1795132800000", botId: "bot", ppm: 410 }],
  },
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
    assert.equal(usage?.usedPercent, 14);
    assert.equal(usage?.windowStart, end - weekMs);
    assert.equal(usage?.windowEnd, end);
  });

  it("adds the per-model weekly limit and the 5-hour session, like /usage", () => {
    const details = parseClaudeUsage(claudeAnswer)?.details;
    const weekEnd = Date.parse("2026-11-29T14:00:00.192Z");
    const sessionEnd = Date.parse("2026-11-24T16:10:00.192Z");
    assert.deepEqual(details, [
      {
        label: "This week · Fable",
        usedPercent: 13,
        windowStart: weekEnd - weekMs,
        windowEnd: weekEnd,
        showElapsed: true,
        timeLabel: "Week",
      },
      {
        label: "5-hour session",
        usedPercent: 24,
        windowStart: sessionEnd - 5 * 60 * 60 * 1000,
        windowEnd: sessionEnd,
        showElapsed: true,
        timeLabel: "Time",
      },
    ]);
  });

  it("falls back to five_hour when limits has no session", () => {
    const details = parseClaudeUsage({ ...claudeAnswer, limits: [] })?.details;
    assert.equal(details?.length, 1);
    assert.equal(details?.[0]?.label, "5-hour session");
    assert.equal(details?.[0]?.usedPercent, 24);
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
      details: [],
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

describe("Grok Bot share", () => {
  it("sums the weekly parts per million into a percent", () => {
    const share = parseGrokBotShare(grokAnswer);
    assert.ok(share !== null && share.usedPercent !== null);
    assert.ok(Math.abs(share.usedPercent - 13.59) < 1e-9);
    assert.equal(share.windowEnd, 1795784622161);
  });

  it("returns null without a weekly breakdown or without any Grok Bot use", () => {
    assert.equal(parseGrokBotShare({ billedCents: {} }), null);
    assert.equal(parseGrokBotShare({ weeklyLimitPpm: { ...grokAnswer.weeklyLimitPpm, bySource: [] } }), null);
  });

  it("skips the split when Grok Bot's week is not Cursor's week", () => {
    const cursor = parseCursorUsage(cursorAnswer);
    const grok = parseGrokBotShare(grokAnswer);
    assert.ok(cursor !== null && grok !== null);
    const lagging = { ...grok, windowStart: grok.windowStart! - weekMs, windowEnd: grok.windowEnd! - weekMs };
    assert.deepEqual(withGrokBotSplit(cursor, lagging).details, []);
  });

  it("splits Cursor's total into Cursor and Grok Bot", () => {
    const cursor = parseCursorUsage({ ...cursorAnswer, planUsage: { totalPercentUsed: 16.39 } });
    assert.ok(cursor !== null);
    const split = withGrokBotSplit(cursor, parseGrokBotShare(grokAnswer));
    assert.deepEqual(
      split.details.map((detail) => [detail.label, Math.round((detail.usedPercent ?? 0) * 100) / 100]),
      [
        ["Cursor", 3],
        ["Grok Bot", 13.59],
      ],
    );
  });

  it("shows only Grok Bot when its share is larger than the total", () => {
    const cursor = parseCursorUsage({ ...cursorAnswer, planUsage: { totalPercentUsed: 5 } });
    assert.ok(cursor !== null);
    const split = withGrokBotSplit(cursor, parseGrokBotShare(grokAnswer));
    assert.deepEqual(split.details.map((detail) => detail.label), ["Grok Bot"]);
  });

  it("leaves Cursor alone when Grok Bot isn't available", () => {
    const cursor = parseCursorUsage(cursorAnswer);
    assert.ok(cursor !== null);
    assert.deepEqual(withGrokBotSplit(cursor, null).details, []);
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
  const usage = { usedPercent: 50, windowStart: 0, windowEnd: weekMs, details: [] };

  it("keeps a window that still contains now", () => {
    assert.equal(rollForward(usage, weekMs - 1), usage);
  });

  it("moves a past window forward by whole weeks and forgets its usage", () => {
    assert.deepEqual(rollForward(usage, 2 * weekMs + 5), {
      usedPercent: null,
      windowStart: 2 * weekMs,
      windowEnd: 3 * weekMs,
      details: [],
    });
  });

  it("clears a finished 5-hour session instead of guessing the next one", () => {
    const hour = 60 * 60 * 1000;
    const session = {
      label: "5-hour session",
      usedPercent: 80,
      windowStart: 0,
      windowEnd: 5 * hour,
      showElapsed: true,
      timeLabel: "Time",
    };
    const rolled = rollForward({ ...usage, details: [session] }, 6 * hour);
    assert.equal(rolled.usedPercent, 50);
    assert.deepEqual(rolled.details[0], { ...session, usedPercent: null, windowStart: null, windowEnd: null });
  });
});
