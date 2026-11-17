import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Charter, CharterPriority } from "./types.js";

const PRIORITY_ORDER: Record<CharterPriority, number> = {
  "P0-conflict": 0,
  "P1-unconfirmed": 1,
  "P2-mainflow": 2,
  "P3-explore": 3,
};

/**
 * Loads charter task sheets from the charters directory and orders them by
 * priority: static conflicts first, then unconfirmed items, main flows,
 * and finally free exploration.
 */
export class Planner {
  async loadCharters(chartersDir = "charters"): Promise<Charter[]> {
    const files = (await readdir(chartersDir)).filter((file) => file.endsWith(".json"));
    const charters: Charter[] = [];
    for (const file of files) {
      const raw = await readFile(path.join(chartersDir, file), "utf-8");
      charters.push(JSON.parse(raw) as Charter);
    }
    return charters.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }
}
