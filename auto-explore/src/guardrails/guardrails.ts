import type { Page } from "playwright";
import { config } from "../config/index.js";

export class GuardrailViolation extends Error {}

const BLOCKED_PATH_PATTERNS = [
  /system\/user/i,
  /system\/role/i,
  /system\/config/i,
  /tool\/gen/i,
];

const BLOCKED_TEXT_PATTERNS = [/\u6279\u91cf\u5220\u9664/, /\u6e05\u7a7a/, /truncate/i];

export function assertTestEnvironment(baseUrl: string): void {
  const url = new URL(baseUrl);
  const allowedHosts = ["localhost", "127.0.0.1"];
  const isLocal = allowedHosts.includes(url.hostname);
  const isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  if (!isLocal && !isPrivateIp) {
    throw new GuardrailViolation(
      `Refuse to run: APP_BASE_URL host '${url.hostname}' is not local/private. ` +
        `Exploratory testing must target an isolated test environment.`,
    );
  }
}

export async function assertEnvFingerprint(page: Page): Promise<void> {
  const fingerprint = config.app.envFingerprint;
  if (!fingerprint) return;
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (!bodyText.includes(fingerprint)) {
    throw new GuardrailViolation(
      `Environment fingerprint '${fingerprint}' not found on page. Aborting for safety.`,
    );
  }
}

export function assertActionAllowed(action: { kind: string; targetText?: string; url?: string }): void {
  if (action.url) {
    const path = new URL(action.url, config.app.baseUrl).pathname;
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(path)) {
        throw new GuardrailViolation(`Blocked navigation to restricted area: ${path}`);
      }
    }
  }
  if (action.targetText) {
    for (const pattern of BLOCKED_TEXT_PATTERNS) {
      if (pattern.test(action.targetText)) {
        throw new GuardrailViolation(`Blocked risky action target: '${action.targetText}'`);
      }
    }
  }
}

export function assertBusinessDbOnly(database: string): void {
  if (!/test|prop/i.test(database)) {
    throw new GuardrailViolation(
      `DB_NAME '${database}' does not look like a test database (must contain 'test' or 'prop').`,
    );
  }
}

const CHARTER_SQL_ALLOWED_START = /^(insert|update|delete)\b/i;
const CHARTER_SQL_BLOCKED_KEYWORDS = /\b(drop|truncate|alter|create|grant|revoke|rename)\b/i;

/**
 * Charter fixtures may only mutate business-prop tables via INSERT/UPDATE/DELETE,
 * and only when ALLOW_CHARTER_SQL=true is explicitly set for the test environment.
 */
export function assertCharterSqlAllowed(sql: string, enabled: boolean): void {
  if (!enabled) {
    throw new GuardrailViolation(
      "Charter setupSql/cleanupSql is disabled. Set ALLOW_CHARTER_SQL=true only in the isolated test environment.",
    );
  }
  const trimmed = sql.trim();
  if (!CHARTER_SQL_ALLOWED_START.test(trimmed)) {
    throw new GuardrailViolation(`Blocked charter SQL (only INSERT/UPDATE/DELETE allowed): ${trimmed.slice(0, 120)}`);
  }
  if (CHARTER_SQL_BLOCKED_KEYWORDS.test(trimmed)) {
    throw new GuardrailViolation(`Blocked charter SQL keyword: ${trimmed.slice(0, 120)}`);
  }
  if (trimmed.replace(/;\s*$/, "").includes(";")) {
    throw new GuardrailViolation(`Multiple SQL statements are not allowed: ${trimmed.slice(0, 120)}`);
  }
  const tables = [...trimmed.matchAll(/\b(?:into|update|from)\s+`?([A-Za-z0-9_]+)`?/gi)].map((match) => match[1]);
  if (tables.length === 0) {
    throw new GuardrailViolation(`Charter SQL must target a prop_ table: ${trimmed.slice(0, 120)}`);
  }
  for (const table of tables) {
    if (!/^prop_/i.test(table)) {
      throw new GuardrailViolation(`Charter SQL may only touch prop_* tables, got '${table}'`);
    }
  }
}
