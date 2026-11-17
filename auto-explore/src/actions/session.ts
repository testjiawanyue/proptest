import type { Browser, BrowserContext, Page } from "playwright";
import { mkdir, writeFile, access } from "node:fs/promises";
import { config } from "../config/index.js";
import { assertEnvFingerprint, assertTestEnvironment } from "../guardrails/guardrails.js";

export interface Session {
  context: BrowserContext;
  page: Page;
}

export async function createSession(browser: Browser, opts: { traceName: string }): Promise<Session> {
  assertTestEnvironment(config.app.baseUrl);

  const context = await browser.newContext({
    baseURL: config.app.baseUrl,
    recordVideo: { dir: `${config.run.traceDir}/${opts.traceName}` },
    locale: "zh-CN",
  });
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  return { context, page };
}

export async function closeSession(session: Session, traceName: string): Promise<string> {
  await mkdir(config.run.traceDir, { recursive: true });
  const tracePath = `${config.run.traceDir}/${traceName}.zip`;
  await session.context.tracing.stop({ path: tracePath });
  await session.context.close();
  return tracePath;
}

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill(config.app.loginUser);
  await page.getByPlaceholder(/密码|password|パスワード/i).first().fill(config.app.loginPassword);

  // RuoYi captcha: expected to be disabled or fixed-value in the test env.
  const captcha = page.getByPlaceholder(/验证码|captcha/i);
  if (await captcha.isVisible().catch(() => false)) {
    throw new Error(
      "Captcha is enabled. Disable it in the test environment (sys_config: sys.account.captchaEnabled=false) or extend login().",
    );
  }

  await page.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  await assertEnvFingerprint(page);
}

export async function saveStorageState(session: Session): Promise<void> {
  await mkdir("storage", { recursive: true });
  await session.context.storageState({ path: config.run.storageStatePath });
}

export async function hasStorageState(): Promise<boolean> {
  try {
    await access(config.run.storageStatePath);
    return true;
  } catch {
    return false;
  }
}
