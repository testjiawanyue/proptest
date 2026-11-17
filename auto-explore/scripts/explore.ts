import { chromium } from "playwright";
import { config } from "../src/config/index.js";
import { Planner } from "../src/agents/planner.js";
import { Explorer } from "../src/agents/explorer.js";
import { Reporter } from "../src/agents/reporter.js";
import { DbProbe } from "../src/probes/dbProbe.js";
import { login, createSession, closeSession, saveStorageState } from "../src/actions/session.js";

async function main(): Promise<void> {
  const planner = new Planner();
  const charters = await planner.loadCharters();
  console.log(`[explore] loaded ${charters.length} charters`);

  const dbProbe = new DbProbe();
  let db: DbProbe | null = null;
  try {
    await dbProbe.connect();
    db = dbProbe;
  } catch (error) {
    console.warn("[explore] DB probe unavailable, db hints will be skipped:", (error as Error).message);
  }

  const browser = await chromium.launch({ headless: config.run.headless });

  const authSession = await createSession(browser, { traceName: "auth-setup" });
  await login(authSession.page);
  await saveStorageState(authSession);
  await closeSession(authSession, "auth-setup");

  const explorer = new Explorer(db);
  await explorer.load();

  const results = [];
  for (const charter of charters) {
    console.log(`[explore] running ${charter.id}: ${charter.title}`);
    const result = await explorer.runCharter(browser, charter);
    console.log(`[explore] ${charter.id} -> ${result.verdict}: ${result.verdictReason}`);
    results.push(result);
  }

  const reporter = new Reporter();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const { jsonPath, mdPath } = await reporter.writeBatch(results, `batch-${stamp}`);
  console.log("[explore] report:", mdPath);

  await db?.close();
  await browser.close();
}

main().catch((error) => {
  console.error("[explore] FAILED:", error.message);
  process.exit(1);
});
