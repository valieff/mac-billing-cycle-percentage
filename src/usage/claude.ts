import { net } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseClaudeCredentials, parseClaudeUsage } from "./parse.js";
import { ProviderError, type FetchResult } from "./types.js";

const run = promisify(execFile);

const usageUrl = "https://api.anthropic.com/api/oauth/usage";
const keychainService = "Claude Code-credentials";

/**
 * Reads the login Claude Code saved. The Keychain item already lists /usr/bin/security as trusted,
 * so macOS does not ask. Claude Code falls back to ~/.claude/.credentials.json when it has no Keychain.
 * The token is never refreshed here: refreshing rotates it and would sign Claude Code out.
 */
async function readClaudeLogin(): Promise<{ accessToken: string; expiresAt: number | null }> {
  try {
    const { stdout } = await run("/usr/bin/security", ["find-generic-password", "-s", keychainService, "-w"], {
      timeout: 10_000,
    });
    const login = parseClaudeCredentials(stdout.trim());
    if (login !== null) {
      return login;
    }
  } catch {
    // No Keychain item; try the file below.
  }
  try {
    const text = await fs.readFile(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8");
    const login = parseClaudeCredentials(text);
    if (login !== null) {
      return login;
    }
  } catch {
    // No file either.
  }
  throw new ProviderError("Sign in to Claude Code first: run claude in a terminal and log in.", "attention");
}

export async function fetchClaudeUsage(): Promise<FetchResult> {
  try {
    const login = await readClaudeLogin();
    if (login.expiresAt !== null && login.expiresAt <= Date.now()) {
      throw new ProviderError("Claude Code's login has expired. Open Claude Code once to renew it.", "stale");
    }

    let response: Response;
    try {
      response = await net.fetch(usageUrl, {
        headers: {
          Authorization: `Bearer ${login.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          Accept: "application/json",
        },
      });
    } catch {
      throw new ProviderError("Can't reach Anthropic. Showing the last reading.", "stale");
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("Claude Code's login was not accepted. Open Claude Code once to renew it.", "stale");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ProviderError(`Anthropic answered ${response.status}. Trying again later.`, "stale", null, true);
    }
    if (!response.ok) {
      throw new ProviderError(`Anthropic answered ${response.status}.`, "stale", null, true);
    }

    const usage = parseClaudeUsage(await response.json());
    if (usage === null) {
      throw new ProviderError("Anthropic doesn't report a weekly limit for this account.", "attention");
    }
    return { kind: "ok", usage };
  } catch (error) {
    if (error instanceof ProviderError) {
      return error.toResult();
    }
    return { kind: "fail", status: "stale", message: "Could not read Claude Code usage.", backoff: true };
  }
}
