import type { Page } from "playwright";

export interface InteractiveElement {
  role: string;
  name: string;
}

export interface PageObservation {
  url: string;
  title: string;
  heading?: string;
  ariaSnapshot: string;
  interactive: InteractiveElement[];
  visibleTextSample: string;
  consoleErrors: string[];
  pageErrors: string[];
  formErrors: string[];
  toastTexts: string[];
  capturedAt: string;
}

const INTERACTIVE_ROLES = ["button", "link", "textbox", "combobox", "checkbox", "radio", "menuitem", "tab", "switch", "searchbox", "option"];

export class PageProbe {
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];

  attach(page: Page): void {
    page.on("console", (msg) => {
      if (msg.type() === "error") this.consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => this.pageErrors.push(String(err)));
  }

  async ariaSnapshot(page: Page): Promise<string> {
    return page.locator("body").ariaSnapshot({ timeout: 5000 }).catch(() => "");
  }

  parseInteractive(ariaSnapshot: string, limit = 60): InteractiveElement[] {
    const elements: InteractiveElement[] = [];
    const pattern = new RegExp(`- (${INTERACTIVE_ROLES.join("|")}) "([^"]+)"`, "g");
    for (const match of ariaSnapshot.matchAll(pattern)) {
      elements.push({ role: match[1], name: match[2] });
      if (elements.length >= limit) break;
    }
    return elements;
  }

  async observe(page: Page, textSampleLength = 800): Promise<PageObservation> {
    const ariaSnapshot = await this.ariaSnapshot(page);
    const heading = await page.locator("h1, h2, .app-breadcrumb, .ant-breadcrumb").first().innerText().catch(() => undefined);
    const bodyText = await page.locator("body").innerText().catch(() => "");

    // Collect Ant Design form validation errors
    const formErrors = await page
      .locator(".ant-form-item-explain-error, .ant-form-item-with-help .ant-form-item-extra")
      .allInnerTexts()
      .catch(() => [] as string[])
      .then((arr) => arr.map((s) => s.trim()).filter(Boolean));

    // Collect Ant Design toast / message notifications
    const toastTexts = await page
      .locator(".ant-message span, .ant-message-notice-content, .ant-notification-notice-message")
      .allInnerTexts()
      .catch(() => [] as string[])
      .then((arr) => arr.map((s) => s.trim()).filter(Boolean));

    return {
      url: page.url(),
      title: await page.title(),
      heading: heading?.trim().slice(0, 120),
      ariaSnapshot: ariaSnapshot.slice(0, 4000),
      interactive: this.parseInteractive(ariaSnapshot),
      visibleTextSample: bodyText.replace(/\s+/g, " ").slice(0, textSampleLength),
      consoleErrors: [...this.consoleErrors],
      pageErrors: [...this.pageErrors],
      formErrors,
      toastTexts,
      capturedAt: new Date().toISOString(),
    };
  }

  async fingerprint(page: Page): Promise<string> {
    const snapshot = await this.ariaSnapshot(page);
    return simpleHash(normalizeSnapshot(snapshot) + "|" + normalizeUrl(page.url()));
  }

  resetErrors(): void {
    this.consoleErrors = [];
    this.pageErrors = [];
  }
}

function simpleHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/**
 * Strip dynamic noise from an ariaSnapshot before hashing.
 * A login page that embeds nonces, CSRF tokens, session IDs, or timestamps would
 * otherwise produce a unique fingerprint on every visit even though the *structure*
 * of the page is identical. We replace obvious variable-length tokens with placeholders
 * so only stable structural content influences the hash.
 */
function normalizeSnapshot(snapshot: string): string {
  let s = snapshot;
  // UUID-style tokens: 8-4-4-4-12 hex
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>");
  // Long hex strings (common for csrf / session tokens, >= 16 chars)
  s = s.replace(/\b[0-9a-f]{16,}\b/gi, "<hex>");
  // ISO timestamps / epoch-ish digits (>= 10 digits that look like time)
  s = s.replace(/\b\d{10,19}\b/g, "<ts>");
  // Base64-ish tokens (long strings with = padding or /+ chars, >= 20 chars)
  s = s.replace(/\b[A-Za-z0-9+/]{20,}={0,2}\b/g, "<b64>");
  // Collapse whitespace so incidental formatting noise doesn't change hash
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Normalize a URL before hashing so query parameters that are known to be
 * volatile (timestamps, CSRF tokens, session redirects) don't fragment otherwise
 * identical pages.
 */
function normalizeUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return raw.split("#")[0]; }

  // Remove volatile query params whose value changes every request
  const volatileKeys = new Set(["_t", "_", "t", "ts", "timestamp", "csrf", "csrf_token", "token", "nonce", "sid", "session", "auth", "sign", "signature", "expires", "redirect"]);
  const kept = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!volatileKeys.has(k.toLowerCase())) kept.append(k, v);
  }
  const searchStr = kept.toString();
  return `${url.pathname}${searchStr ? "?" + searchStr : ""}`;
}
