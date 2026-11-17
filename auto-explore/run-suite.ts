/**
 * run-suite.ts — 测试套件统一执行入口
 *
 * 职责（对应整改计划 A1）：
 *  1. 以 suite.json 为唯一套件清单，按 tag / layer 选择要跑的条目；
 *  2. 逐条执行命令（tsx 脚本 / pytest / 任意 shell 命令），失败自动重试 1 次并标记 flaky；
 *  3. 每轮产出 reports/summary-{时间戳}.json 与逐条日志，供门禁报告消费。
 *
 * 常用命令：
 *  npm run suite:sync            # 重新扫描 scripts/ 生成 suite.json（保留已有 tag）
 *  npm run suite -- --list       # 只列出选中的条目，不执行
 *  npm run suite -- --tag=smoke  # 跑冒烟
 *  npm run suite -- --tag=mainflow,l2
 *  npm run suite -- --dry-run --tag=smoke
 *
 * 纪律：
 *  - 新增/修改自动化用例后必须 `npm run suite:sync` 并确认 tag，否则回归会漏（整改计划 §3 批次纪律）；
 *  - destructive 条目默认串行执行，不提供并发选项。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SUITE_FILE = path.join(ROOT, "suite.json");
const REPORT_DIR = path.join(ROOT, "reports");
const LOG_ROOT = path.join(REPORT_DIR, "suite");

type Entry = {
  id: string;
  cmd: string;
  cwd?: string;
  tags: string[];
  timeoutSec?: number;
  enabled?: boolean;
  note?: string;
};

type Suite = { version: 1; generatedAt: string; entries: Entry[] };

type Result = {
  id: string;
  cmd: string;
  tags: string[];
  status: "pass" | "fail" | "flaky" | "skip";
  attempts: number;
  durationMs: number;
  logPath?: string;
};

// ---------- CLI ----------
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const DO_SYNC = has("sync");
const LIST_ONLY = has("list") || has("dry-run");
const TAGS = (opt("tag") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
const EXCLUDE = (opt("exclude") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
const RETRY = Number(opt("retry") ?? "1");
const DEFAULT_TIMEOUT = Number(opt("timeout") ?? "600");

function fail(msg: string): never {
  console.error(`[suite] ${msg}`);
  process.exit(1);
}

// ---------- sync：扫描 scripts/ 推断 tag，保留人工维护的 tag ----------
function inferTags(relPath: string): string[] {
  const norm = relPath.replace(/\\/g, "/");
  if (norm === "scripts/smoke.ts") return ["smoke"];
  if (norm === "scripts/selftest.ts" || norm === "scripts/report.ts") return ["tool"];
  if (/^scripts\/(debug|_tmp)/.test(norm) || /_tmp/.test(path.basename(norm))) return ["archive"];
  if (norm.startsWith("scripts/cleanup/")) return ["cleanup", "destructive"];
  const top = norm.split("/")[1];
  const base = path.basename(norm, ".ts");
  const moduleTag = top && !top.endsWith(".ts") ? [`module:${top}`] : ["module:misc"];
  if (base.startsWith("inspect-") || base.startsWith("observe-")) return ["inspect", ...moduleTag];
  return moduleTag;
}

function syncSuite(): Suite {
  const prev = fs.existsSync(SUITE_FILE)
    ? (JSON.parse(fs.readFileSync(SUITE_FILE, "utf8")) as Suite)
    : { entries: [] as Entry[] };
  const prevByCmd = new Map(prev.entries.map((e) => [e.cmd, e]));

  const entries: Entry[] = [];

  // 1) L0/L2 外部命令（人工维护段，sync 不覆盖）
  const L2_PYTEST = "py -3.11 -m pytest -m mainflow -vv --base-url=http://localhost:8090";
  entries.push({
    id: "l2-webauto-mainflow",
    cmd: L2_PYTEST,
    cwd: path.join(ROOT, "..", "webauto", "webtest"),
    tags: ["l2", "mainflow"],
    timeoutSec: 900,
    note: "webauto 11 条主流程（L2 主干）",
  });

  // 2) auto-explore scripts 全量扫描
  const scriptsDir = path.join(ROOT, "scripts");
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) out.push(...walk(full));
      else if (name.endsWith(".ts")) out.push(full);
    }
    return out;
  };
  for (const file of walk(scriptsDir).sort()) {
    const rel = path.relative(ROOT, file);
    const old = prevByCmd.get(rel);
    entries.push({
      id: path.basename(rel, ".ts").replace(/[^a-zA-Z0-9_-]/g, "-"),
      cmd: `npx tsx "${rel}"`,
      cwd: ROOT,
      tags: old?.tags?.length ? old.tags : inferTags(rel),
      timeoutSec: old?.timeoutSec ?? DEFAULT_TIMEOUT,
      enabled: old?.enabled ?? true,
    });
  }

  const suite: Suite = { version: 1, generatedAt: new Date().toISOString(), entries };
  fs.writeFileSync(SUITE_FILE, `${JSON.stringify(suite, null, 2)}\n`, "utf8");
  console.log(`[suite] suite.json 已生成：${entries.length} 条目`);
  return suite;
}

// ---------- 选择 ----------
function select(entries: Entry[]): Entry[] {
  let picked = entries.filter((e) => e.enabled !== false);
  if (TAGS.length) picked = picked.filter((e) => e.tags.some((t) => TAGS.includes(t)));
  if (EXCLUDE.length) picked = picked.filter((e) => !e.tags.some((t) => EXCLUDE.includes(t)));
  // archive 永不默认执行：未指定 tag 时跳过
  if (!TAGS.length) picked = picked.filter((e) => !e.tags.includes("archive"));
  return picked;
}

// ---------- 执行 ----------
function runOnce(entry: Entry, logPath: string): Promise<{ code: number; durationMs: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const cwd = entry.cwd && path.isAbsolute(entry.cwd) ? entry.cwd : path.resolve(ROOT, entry.cwd ?? ".");
    const child = spawn(entry.cmd, {
      shell: true,
      cwd,
      env: { ...process.env, SUITE_ENTRY_ID: entry.id },
    });
    const log = fs.createWriteStream(logPath, { flags: "w" });
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    const timer = setTimeout(() => {
      log.write(`\n[suite] 超时（${entry.timeoutSec ?? DEFAULT_TIMEOUT}s），终止\n`);
      child.kill("SIGKILL");
    }, (entry.timeoutSec ?? DEFAULT_TIMEOUT) * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      log.end();
      resolve({ code: code ?? -1, durationMs: Date.now() - started });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      log.write(`\n[suite] 启动失败：${err.message}\n`);
      log.end();
      resolve({ code: -1, durationMs: Date.now() - started });
    });
  });
}

async function runAll(picked: Entry[]): Promise<Result[]> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(LOG_ROOT, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const results: Result[] = [];

  for (const entry of picked) {
    if (LIST_ONLY) {
      console.log(`[dry-run] ${entry.id}  tags=[${entry.tags.join(",")}]  ${entry.cmd}`);
      results.push({ id: entry.id, cmd: entry.cmd, tags: entry.tags, status: "skip", attempts: 0, durationMs: 0 });
      continue;
    }
    const logPath = path.join(runDir, `${entry.id}.log`);
    process.stdout.write(`▶ ${entry.id} ... `);
    let attempts = 0;
    let ok = false;
    let durationMs = 0;
    while (attempts <= RETRY) {
      attempts += 1;
      const r = await runOnce(entry, logPath);
      durationMs += r.durationMs;
      ok = r.code === 0;
      if (ok) break;
      if (attempts <= RETRY) fs.appendFileSync(logPath, `\n[suite] 第 ${attempts} 次失败，重试\n`);
    }
    const status: Result["status"] = ok ? (attempts > 1 ? "flaky" : "pass") : "fail";
    console.log(status === "pass" ? "✓ pass" : status === "flaky" ? `△ flaky（第 ${attempts} 次才过）` : `✗ fail（日志：${logPath}）`);
    results.push({ id: entry.id, cmd: entry.cmd, tags: entry.tags, status, attempts, durationMs, logPath });
  }

  if (!LIST_ONLY) {
    const passed = results.filter((r) => r.status === "pass").length;
    const flaky = results.filter((r) => r.status === "flaky").length;
    const failed = results.filter((r) => r.status === "fail").length;
    const summary = {
      runId,
      startedAt: runId,
      selected: picked.length,
      passed,
      flaky,
      failed,
      total: results.length,
      durationMs: results.reduce((s, r) => s + r.durationMs, 0),
      results,
    };
    const out = path.join(REPORT_DIR, `summary-${runId}.json`);
    fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`\n[suite] 汇总：${passed} 通过 / ${flaky} flaky / ${failed} 失败（共 ${results.length}）`);
    console.log(`[suite] 报告：${out}`);
    if (failed > 0) process.exitCode = 1;
  }
  return results;
}

// ---------- main ----------
async function main() {
  if (DO_SYNC) {
    const suite = syncSuite();
    const byTag: Record<string, number> = {};
    for (const e of suite.entries) for (const t of e.tags) byTag[t] = (byTag[t] ?? 0) + 1;
    console.log(`[suite] tag 分布：${JSON.stringify(byTag)}`);
    console.log('[suite] sync 完成（只同步不执行；执行请用 npm run suite -- --tag=...）');
    return;
  }
  const suite = readSuite();
  const picked = select(suite.entries);
  if (!picked.length) fail("没有选中任何条目（检查 --tag 是否拼写正确）");
  console.log(`[suite] 选中 ${picked.length} / ${suite.entries.length} 条目${TAGS.length ? `（tag=${TAGS.join(",")}）` : ""}\n`);
  await runAll(picked);
}

function readSuite(): Suite {
  if (!fs.existsSync(SUITE_FILE)) fail("suite.json 不存在，请先执行 npm run suite:sync");
  return JSON.parse(fs.readFileSync(SUITE_FILE, "utf8")) as Suite;
}

main().catch((err) => fail(err?.stack ?? String(err)));
