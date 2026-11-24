export type CharterPriority = "P0-conflict" | "P1-unconfirmed" | "P2-mainflow" | "P3-explore";

export interface Charter {
  id: string;
  title: string;
  priority: CharterPriority;
  goal: string;
  linkedReqIds: string[];
  linkedBrIds: string[];
  linkedCaseIds: string[];
  startUrl: string;
  constraints: string[];
  oracleHints: OracleHint[];
  /** 仅测试库可用：charter 开始前执行的夹具 SQL（INSERT/UPDATE/DELETE prop_*），需 ALLOW_CHARTER_SQL=true。 */
  setupSql?: string[];
  /** 仅测试库可用：无论结果如何都在 finally 执行的恢复 SQL，支持 {{runStartedAt}} 占位符。 */
  cleanupSql?: string[];
  maxSteps?: number;
}

export interface OracleHint {
  kind: "api" | "db" | "ui-text" | "form-error" | "toast-text" | "no-api-call";
  description: string;
  /** api/ui-text/form-error/toast-text: 期望包含的字符串；no-api-call: 不应被调用的路径片段；db: 可选，表示变化后数量应满足的条件（">0"/"===0"/">=N"） */
  expect?: string;
  sql?: string;
  keyField?: string;
}

export type VerdictLevel = "pass" | "fail" | "pending" | "unconfirmed" | "off-baseline";

export interface StepRecord {
  stepIndex: number;
  action: string;
  observationUrl: string;
  heading?: string;
  isNewState: boolean;
  apiErrors: number;
  consoleErrors: number;
}

export interface CharterResult {
  charterId: string;
  /**  Charter.title —— 中文/日文可读的场景名，Reporter 里和 charterId 一起展示，方便快速对照测试功能。 */
  charterTitle?: string;
  verdict: VerdictLevel;
  verdictReason: string;
  steps: StepRecord[];
  evidence: {
    tracePath?: string;
    screenshots: string[];
    apiErrors: unknown[];
    dbDiffs: unknown[];
    stateCoverage?: import("../state-graph/stateGraph.js").StateCoverage;
  };
  startedAt: string;
  finishedAt: string;
}
