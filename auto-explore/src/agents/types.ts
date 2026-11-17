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
  maxSteps?: number;
}

export interface OracleHint {
  kind: "api" | "db" | "ui-text";
  description: string;
  expect?: string;
  sql?: string;
  keyField?: string;
}

export type VerdictLevel = "pass" | "fail" | "unconfirmed" | "off-baseline";

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
  verdict: VerdictLevel;
  verdictReason: string;
  steps: StepRecord[];
  evidence: {
    tracePath?: string;
    screenshots: string[];
    apiErrors: unknown[];
    dbDiffs: unknown[];
  };
  startedAt: string;
  finishedAt: string;
}
