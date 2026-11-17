import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { PageProbe } from "../../src/probes/pageProbe.js";
import { NetworkProbe } from "../../src/probes/networkProbe.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const tables = await db.snapshot("tables", "SHOW TABLES LIKE 'prop%'");
  console.log("[inspect] prop tables:", tables.rows.map((r) => Object.values(r)[0]).join(", "));

  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "inspect-customer" });
  const pageProbe = new PageProbe();
  const networkProbe = new NetworkProbe();
  pageProbe.attach(session.page);
  networkProbe.attach(session.page);

  try {
    await login(session.page);
    await session.page.goto("/customer");
    await session.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await session.page.waitForTimeout(1500);

    const observation = await pageProbe.observe(session.page);
    console.log("[inspect] url:", observation.url);
    console.log("[inspect] heading:", observation.heading);
    console.log("[inspect] text sample:", observation.visibleTextSample.slice(0, 300));
    console.log("[inspect] interactive count:", observation.interactive.length);
    console.log("[inspect] interactive:", observation.interactive.slice(0, 25).map((el) => `${el.role}:"${el.name}"`).join(" | "));
    console.log("[inspect] aria len:", observation.ariaSnapshot.length);
    console.log("[inspect] aria head:", observation.ariaSnapshot.slice(0, 400).replace(/\n/g, " / "));
    console.log("[inspect] api:", JSON.stringify(networkProbe.summary()));
  } finally {
    await closeSession(session, "inspect-customer");
    await db.close();
    await browser.close();
  }
}

main().catch((error) => { console.error("[inspect] FAILED:", error.message); process.exit(1); });

