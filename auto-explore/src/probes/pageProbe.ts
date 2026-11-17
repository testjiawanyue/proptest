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

    return {
      url: page.url(),
      title: await page.title(),
      heading: heading?.trim().slice(0, 120),
      ariaSnapshot: ariaSnapshot.slice(0, 4000),
      interactive: this.parseInteractive(ariaSnapshot),
      visibleTextSample: bodyText.replace(/\s+/g, " ").slice(0, textSampleLength),
      consoleErrors: [...this.consoleErrors],
      pageErrors: [...this.pageErrors],
      capturedAt: new Date().toISOString(),
    };
  }

  async fingerprint(page: Page): Promise<string> {
    const snapshot = await this.ariaSnapshot(page);
    return simpleHash(snapshot + "|" + page.url());
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
