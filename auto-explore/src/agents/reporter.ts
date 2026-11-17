import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";
import type { CharterResult } from "./types.js";

export class Reporter {
  async writeBatch(results: CharterResult[], batchName: string): Promise<{ jsonPath: string; mdPath: string }> {
    await mkdir(config.run.reportsDir, { recursive: true });
    const jsonPath = path.join(config.run.reportsDir, `${batchName}.json`);
    const mdPath = path.join(config.run.reportsDir, `${batchName}.md`);

    await writeFile(jsonPath, JSON.stringify({ batch: batchName, generatedAt: new Date().toISOString(), results }, null, 2), "utf-8");
    await writeFile(mdPath, this.renderMarkdown(batchName, results), "utf-8");
    return { jsonPath, mdPath };
  }

  private renderMarkdown(batchName: string, results: CharterResult[]): string {
    const counts = { pass: 0, fail: 0, unconfirmed: 0, "off-baseline": 0 };
    for (const result of results) counts[result.verdict] += 1;

    const lines: string[] = [
      `# 探索批次报告：${batchName}`,
      "",
      `生成时间：${new Date().toISOString()}`,
      "",
      `| 结论 | 数量 |`,
      `|---|---:|`,
      `| 通过 | ${counts.pass} |`,
      `| 失败 | ${counts.fail} |`,
      `| 无法确认 | ${counts.unconfirmed} |`,
      `| 基线外发现 | ${counts["off-baseline"]} |`,
      "",
      `| 任务单 | 结论 | 步数 | 接口异常 | 原因 | Trace |`,
      `|---|---|---:|---:|---|---|`,
    ];
    for (const result of results) {
      lines.push(
        `| ${result.charterId} | ${result.verdict} | ${result.steps.length} | ${result.evidence.apiErrors.length} | ${result.verdictReason.replace(/\|/g, "/")} | ${result.evidence.tracePath ?? "-"} |`,
      );
    }
    lines.push("");
    return lines.join("\n");
  }
}
