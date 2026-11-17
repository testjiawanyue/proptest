import { chromium } from "playwright";
import { config } from "../src/config/index.js";
import { createSession, closeSession, login, saveStorageState } from "../src/actions/session.js";
import { PageProbe } from "../src/probes/pageProbe.js";
import { NetworkProbe } from "../src/probes/networkProbe.js";
import { DbProbe } from "../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "smoke" });

  const pageProbe = new PageProbe();
  const networkProbe = new NetworkProbe();
  pageProbe.attach(session.page);
  networkProbe.attach(session.page);

  const dbProbe = new DbProbe();
  let dbOk = false;
  try {
    await dbProbe.connect();
    dbOk = true;
    console.log("[smoke] DB probe connected:", config.db.database);
  } catch (error) {
    console.warn("[smoke] DB probe skipped:", (error as Error).message);
  }

  try {
    await login(session.page);
    console.log("[smoke] login ok:", session.page.url());
    await saveStorageState(session);

    await session.page.goto("/");
    const observation = await pageProbe.observe(session.page);
    console.log("[smoke] dashboard heading:", observation.heading ?? "(none)");
    console.log("[smoke] interactive elements:", observation.interactive.length);
    console.log("[smoke] console errors:", observation.consoleErrors.length, "| page errors:", observation.pageErrors.length);
    console.log("[smoke] api summary:", JSON.stringify(networkProbe.summary()));

    if (dbOk) {
      const snapshot = await dbProbe.snapshot("customer count", "SELECT COUNT(*) AS cnt FROM prop_customer").catch(() => null);
      if (snapshot) console.log("[smoke] prop_customer rows:", JSON.stringify(snapshot.rows));
    }
  } finally {
    const tracePath = await closeSession(session, "smoke");
    await dbProbe.close();
    await browser.close();
    console.log("[smoke] trace saved:", tracePath);
  }
}

main().catch((error) => {
  console.error("[smoke] FAILED:", error.message);
  process.exit(1);
});
