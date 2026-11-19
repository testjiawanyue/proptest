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
    const counts: Record<string, number> = { pass: 0, fail: 0, unconfirmed: 0, "off-baseline": 0, pending: 0 };
    for (const result of results) counts[result.verdict] = (counts[result.verdict] ?? 0) + 1;

    // Aggregate coverage across all charters in the batch.
    // The final state graph persists across runs, so the *last* coverage snapshot
    // in the batch is the most accurate "end of batch" picture.
    const finalCoverage = [...results].reverse().find((r) => r.evidence.stateCoverage)?.evidence.stateCoverage;

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
      `| 任务单 ID（场景） | 结论 | 步数 | 接口异常 | 原因 | Trace |`,
      `|---|---|---:|---:|---|---|`,
    ];
    for (const result of results) {
      const title = result.charterTitle ? `<br><sub>${result.charterTitle}</sub>` : "";
      lines.push(
        `| \`${result.charterId}\`${title} | ${result.verdict} | ${result.steps.length} | ${result.evidence.apiErrors.length} | ${result.verdictReason.replace(/\|/g, "/")} | ${result.evidence.tracePath ?? "-"} |`,
      );
    }

    // --- State Coverage Section ---
    if (finalCoverage) {
      lines.push("");
      lines.push("## 状态覆盖度（批次末快照）");
      lines.push("");
      lines.push(`| 指标 | 值 | 含义 |`);
      lines.push(`|---|---:|---|`);
      lines.push(`| 累计访问不同状态总数 | ${finalCoverage.totalStatesEverVisited} | 跨批次所有探索见过的不同页面状态数（unique fingerprint） |`);
      lines.push(`| 累计状态转移数 | ${finalCoverage.totalTransitions} | A→点击→B 这种转移的 distinct 数量 |`);
      lines.push(`| 本批次新发现状态 | **${finalCoverage.novelStatesThisRun}** | 本次批次第一次见到的状态数——衡量"探索发现力" |`);
      lines.push(`| 平均访问次数/状态 | ${finalCoverage.avgVisitsPerNode.toFixed(2)} | 越高 = Agent 在小范围打转，新颖度不足 |`);
      lines.push("");

      lines.push("### 按模块分组");
      lines.push("");
      lines.push(`| 模块 | 不同状态 | 转移数 | 本批次新发现 |`);
      lines.push(`|---|---:|---:|---:|`);
      const sortedModules = Object.entries(finalCoverage.byModule).sort((a, b) => b[1].states - a[1].states);
      for (const [modKey, info] of sortedModules) {
        lines.push(`| ${modKey} | ${info.states} | ${info.transitions} | ${info.novelThisRun} |`);
      }
      lines.push("");

      if (finalCoverage.hotspots.length > 0) {
        lines.push("### 热点状态（Agent 反复访问）");
        lines.push("");
        lines.push(`| 指纹 | 访问次数 | URL | 标题 |`);
        lines.push(`|---|---:|---|---|`);
        for (const h of finalCoverage.hotspots) {
          lines.push(`| \`${h.fingerprint}\` | ${h.visits} | ${h.url} | ${(h.heading ?? "-").slice(0, 40)} |`);
        }
        lines.push("");
      }

      if (finalCoverage.unvisitedTargets.length > 0) {
        lines.push("### 未抵达的 Edge 终点（Agent 曾承诺跳转但从未真正到达）");
        lines.push("");
        lines.push(`| 目标指纹 | 来源转移（前 5 条） |`);
        lines.push(`|---|---|`);
        for (const t of finalCoverage.unvisitedTargets) {
          lines.push(`| \`${t.fingerprint}\` | ${t.incomingTransitions.join("<br>")} |`);
        }
        lines.push("");
        lines.push("> 💡 这些是潜在未覆盖路径——Agent 某次操作生成了指向它们的 edge，但自己没走到。下次可以针对性加 Charter 探索。");
        lines.push("");
      }
    } else {
      lines.push("");
      lines.push("## 状态覆盖度");
      lines.push("");
      lines.push("_（未采集到 state coverage——可能是 StateGraph 未初始化）_");
      lines.push("");
    }

    return lines.join("\n");
  }
}
