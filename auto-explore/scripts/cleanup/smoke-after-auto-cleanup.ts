/** 清理后只读 smoke：登录并检查订单/产品/批量准备接口。 */
import "dotenv/config";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

type ApiResult = { path: string; http: number; code: number; msg: string; total?: number; rows?: number };

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: process.env.APP_BASE_URL });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill(process.env.APP_LOGIN_USER!);
    await page.getByPlaceholder(/密码|password|パスワード/i).first().fill(process.env.APP_LOGIN_PASSWORD!);
    await page.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

    const prefix = process.env.APP_API_PREFIX ?? "/dev-api";
    const token = (await context.cookies()).find((cookie) => cookie.name === "Admin-Token")?.value;
    if (!token) throw new Error("登录成功但未取得 Admin-Token Cookie");
    const paths = [
      "/prop/order/list?pageNum=1&pageSize=10",
      "/prop/production/product-list?pageNum=1&pageSize=50",
      "/prop/shipment/batch-preparations",
      "/prop/order/17",
      "/prop/production/products/35",
    ];
    const results: ApiResult[] = [];
    for (const path of paths) {
      const response = await page.request.get(`${prefix}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as Record<string, unknown>;
      results.push({
        path,
        http: response.status(),
        code: Number(body.code ?? -1),
        msg: String(body.msg ?? ""),
        total: typeof body.total === "number" ? body.total : undefined,
        rows: Array.isArray(body.rows) ? body.rows.length : undefined,
      });
    }

    await page.goto("/orders/index", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const ui = {
      path: new URL(page.url()).pathname,
      hasOrderTable: (await page.locator(".ant-table").count()) > 0,
      bodyError: (await page.locator("text=404 页面未找到").count()) > 0,
    };
    const failed = results.filter((item) => item.http >= 400 || item.code !== 200);
    const payload = { checkedAt: new Date().toISOString(), results, ui, failed: failed.length };
    await writeFile("reports/cleanup-auto-smoke.json", JSON.stringify(payload, null, 2), "utf-8");
    console.log(JSON.stringify(payload, null, 2));
    if (failed.length) process.exitCode = 1;
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("smoke 失败：", error);
  process.exit(1);
});
