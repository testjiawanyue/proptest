import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CharterResult } from "../src/agents/types.js";

async function main(): Promise<void> {
  const reportsDir = "reports";
  const files = (await readdir(reportsDir)).filter((file) => file.startsWith("batch-") && file.endsWith(".json")).sort();
  if (files.length === 0) {
    console.log("no batch reports found. Run: npm run explore");
    return;
  }
  const latest = files.at(-1)!;
  const data = JSON.parse(await readFile(path.join(reportsDir, latest), "utf-8")) as { results: CharterResult[] };
  const counts: Record<string, number> = {};
  for (const result of data.results) counts[result.verdict] = (counts[result.verdict] ?? 0) + 1;
  console.log(`latest batch: ${latest}`);
  console.log("verdicts:", JSON.stringify(counts));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
