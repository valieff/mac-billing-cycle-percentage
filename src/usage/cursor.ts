import { app, net, safeStorage } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { decryptCursorToken, isEncryptedCursorToken, jwtExpiry, parseCursorUsage, unquote } from "./parse.js";
import { ProviderError, type FetchResult } from "./types.js";

const run = promisify(execFile);

const usageUrl = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const stateDatabase = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Cursor",
  "User",
  "globalStorage",
  "state.vscdb",
);
const safeStorageService = "Cursor Safe Storage";

function savedTokenPath(): string {
  return path.join(app.getPath("userData"), "cursor-token.bin");
}

/**
 * Reads Cursor's stored login with one primary-key lookup. The database can be tens of gigabytes,
 * so it is opened read-only and never scanned.
 */
async function readStoredLogin(): Promise<string> {
  try {
    await fs.access(stateDatabase);
  } catch {
    throw new ProviderError("Cursor isn't installed, or hasn't been opened yet.", "attention");
  }
  let stdout: string;
  try {
    ({ stdout } = await run(
      "/usr/bin/sqlite3",
      ["-readonly", stateDatabase, "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';"],
      { timeout: 15_000 },
    ));
  } catch {
    throw new ProviderError("Could not read Cursor's settings. Quit and reopen Cursor, then try again.", "attention");
  }
  const stored = unquote(stdout.trim());
  if (stored === "") {
    throw new ProviderError("Sign in to Cursor first, then connect again.", "attention");
  }
  return stored;
}

/**
 * Asks macOS for Cursor's encryption key. This shows a Keychain prompt because the item trusts only
 * Cursor.app. The key is used once, here, and never stored.
 */
async function readSafeStoragePassword(): Promise<string> {
  try {
    const { stdout } = await run("/usr/bin/security", ["find-generic-password", "-s", safeStorageService, "-w"], {
      timeout: 120_000,
    });
    const password = stdout.trim();
    if (password !== "") {
      return password;
    }
  } catch {
    // Denied, cancelled or missing; reported below.
  }
  throw new ProviderError("macOS didn't allow access to Cursor's login. Connect again and click Allow.", "attention");
}

async function saveToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new ProviderError("macOS encryption isn't available, so the Cursor login can't be kept safely.", "attention");
  }
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(savedTokenPath(), safeStorage.encryptString(token), { mode: 0o600 });
}

async function loadToken(): Promise<string> {
  try {
    const token = safeStorage.decryptString(await fs.readFile(savedTokenPath()));
    if (token !== "") {
      return token;
    }
  } catch {
    // Missing or unreadable; ask the user to connect again.
  }
  throw new ProviderError("Reconnect Cursor to keep reading its usage.", "attention", "reconnect");
}

export async function forgetCursorToken(): Promise<void> {
  await fs.rm(savedTokenPath(), { force: true });
}

/**
 * Reads Cursor's login, decrypting it if needed, checks that it works, and keeps it encrypted with
 * this app's own key. Only runs when the user clicks Connect.
 */
export async function connectCursor(): Promise<FetchResult> {
  try {
    const stored = await readStoredLogin();
    let token: string;
    if (isEncryptedCursorToken(stored)) {
      const password = await readSafeStoragePassword();
      try {
        token = decryptCursorToken(stored, password);
      } catch {
        throw new ProviderError("Could not decrypt Cursor's login. Sign out of Cursor and back in, then retry.", "attention");
      }
    } else {
      token = stored;
    }
    const result = await fetchWithToken(token);
    if (result.kind === "ok") {
      await saveToken(token);
    }
    return result;
  } catch (error) {
    if (error instanceof ProviderError) {
      return error.toResult();
    }
    return { kind: "fail", status: "attention", message: "Could not connect to Cursor." };
  }
}

export async function fetchCursorUsage(): Promise<FetchResult> {
  try {
    return await fetchWithToken(await loadToken());
  } catch (error) {
    if (error instanceof ProviderError) {
      return error.toResult();
    }
    return { kind: "fail", status: "stale", message: "Could not read Cursor usage.", backoff: true };
  }
}

async function fetchWithToken(token: string): Promise<FetchResult> {
  const expiry = jwtExpiry(token);
  if (expiry !== null && expiry <= Date.now()) {
    throw new ProviderError("Cursor's login has expired. Reconnect Cursor.", "attention", "reconnect");
  }

  let response: Response;
  try {
    response = await net.fetch(usageUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
    });
  } catch {
    throw new ProviderError("Can't reach Cursor. Showing the last reading.", "stale");
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderError("Cursor didn't accept the saved login. Reconnect Cursor.", "attention", "reconnect");
  }
  if (response.status === 429 || response.status >= 500) {
    throw new ProviderError(`Cursor answered ${response.status}. Trying again later.`, "stale", null, true);
  }
  if (!response.ok) {
    throw new ProviderError(`Cursor answered ${response.status}.`, "stale", null, true);
  }

  const usage = parseCursorUsage(await response.json());
  if (usage === null) {
    throw new ProviderError("Cursor reports no usage limit for this plan.", "attention");
  }
  return { kind: "ok", usage };
}
