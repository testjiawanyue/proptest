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
