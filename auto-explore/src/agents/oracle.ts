import type { PageObservation } from "../probes/pageProbe.js";
import type { NetworkProbe } from "../probes/networkProbe.js";
import type { DbProbe, DbDiff, DbSnapshot } from "../probes/dbProbe.js";
import type { Charter, VerdictLevel } from "./types.js";

export interface Verdict {
  level: "pass" | "fail" | "pending" | "unconfirmed" | "off-baseline";
  reason: string;
}

/**
 * Three-level oracle:
 *  1. hard rules   - HTTP errors, console errors, expected UI text (free, immediate)
 *  2. baseline/db  - oracle hints from the charter, incl. DB before/after snapshots
 *  3. semantic     - LLM judgement (deferred; always downgraded to unconfirmed for human review)
 */
export class Oracle {
  readonly collectedDiffs: DbDiff[] = [];
  private pendingSnapshots: { hintIndex: number; before: DbSnapshot }[] = [];
  private runStartedAtSql = "";

  constructor(private dbProbe: DbProbe | null) {}

  /** Timestamp used to scope run-generated rows in `{{runStartedAt}}` placeholders. */
  setRunStartedAt(iso: string): void {
    const date = new Date(iso);
    this.runStartedAtSql = Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 19).replace("T", " ");
  }

  private withRunTime(sql: string): string {
    return this.runStartedAtSql ? sql.replaceAll("{{runStartedAt}}", `'${this.runStartedAtSql}'`) : sql;
  }

  async checkInvariants(charter: Charter, observation: PageObservation, network: NetworkProbe): Promise<Verdict | null> {
    const apiErrors = network.errors();
    const serverErrors = apiErrors.filter((call) => (call as { status?: number }).status !== undefined && ((call as { status?: number }).status! >= 500));
    if (serverErrors.length > 0) {
      return { level: "fail", reason: `server error during exploration: ${JSON.stringify(serverErrors[0]).slice(0, 300)}` };
    }
    if (observation.pageErrors.length > 0) {
      return { level: "fail", reason: `uncaught page error: ${observation.pageErrors[0].slice(0, 300)}` };
    }
    return null;
  }

  async takeBeforeSnapshots(charter: Charter): Promise<void> {
    if (!this.dbProbe) return;
    this.pendingSnapshots = [];
    charter.oracleHints.forEach((hint, hintIndex) => {
      if (hint.kind === "db" && hint.sql) {
        this.pendingSnapshots.push({ hintIndex, before: null as unknown as DbSnapshot });
      }
    });
    for (const pending of this.pendingSnapshots) {
      const hint = charter.oracleHints[pending.hintIndex];
      pending.before = await this.dbProbe.snapshot(hint.description, this.withRunTime(hint.sql!));
    }
  }

  /**
   * Evaluate all oracle hints. Returns one of:
   *   pass    – every hint is satisfied (auto-done safe)
   *   fail    – a hint is violated and cannot be recovered (e.g. no-api-call was called)
   *   pending – some hint is not yet satisfied but the target may still be reachable (e.g. expected API never called yet)
   *
   * Called at every step as well as on explicit "done", so the Explorer can short-circuit as soon
   * as the hints align instead of burning all maxSteps.
   */
  async evaluateCharter(charter: Charter, observation: PageObservation, network: NetworkProbe): Promise<Verdict> {
    let anyPending = false;
    for (const hint of charter.oracleHints) {
      switch (hint.kind) {
        case "ui-text": {
          const observedText = `${observation.visibleTextSample} ${observation.dialogTexts.join(" ")}`;
          if (hint.expect && !observedText.includes(hint.expect)) {
            anyPending = true;
          }
          break;
        }
        case "api": {
          if (hint.expect) {
            const matched = network.calls.some((call) => call.path.includes(hint.expect!));
            if (!matched) anyPending = true;
          }
          break;
        }
        case "no-api-call": {
          if (hint.expect) {
            const matched = network.calls.some((call) => call.path.includes(hint.expect!));
            if (matched) {
              return { level: "fail", reason: `unexpected API call was made: '${hint.expect}' should NOT be called (${hint.description})` };
            }
          }
          break;
        }
        case "form-error": {
          if (hint.expect && !observation.formErrors.some((e) => e.includes(hint.expect!))) {
            anyPending = true;
          }
          break;
        }
        case "toast-text": {
          if (hint.expect && !observation.toastTexts.some((t) => t.includes(hint.expect!))) {
            anyPending = true;
          }
          break;
        }
        case "db": {
          if (hint.sql && this.dbProbe) {
            const pending = this.pendingSnapshots.find((item) => charter.oracleHints[item.hintIndex] === hint);
            if (pending?.before) {
              const after = await this.dbProbe.snapshot(hint.description, this.withRunTime(hint.sql));
              const diff = this.dbProbe.diff(hint.description, pending.before, after, hint.keyField ?? "id");
              this.collectedDiffs.push(diff);
              if (hint.expect) {
                const evalContext: Record<string, number> = {
                  beforeCount: diff.beforeCount,
                  afterCount: diff.afterCount,
                  added: diff.added.length,
                  removed: diff.removed.length,
                  changed: diff.added.length + diff.removed.length,
                };
                const ok = safeEval(hint.expect, evalContext);
                if (!ok) anyPending = true;
              } else if (diff.beforeCount === diff.afterCount && diff.added.length === 0 && diff.removed.length === 0) {
                anyPending = true;
              }
            } else {
              anyPending = true;
            }
          } else if (hint.sql) {
            anyPending = true; // db hint without probe is pending forever
          }
          break;
        }
      }
    }
    if (anyPending) {
      return { level: "pending", reason: "not all oracle hints satisfied yet" };
    }
    return { level: "pass", reason: "all oracle hints satisfied" };
  }

  reset(): void {
    this.collectedDiffs.length = 0;
    this.pendingSnapshots = [];
  }
}

/**
 * Minimal safe evaluator for DB diff conditions.
 * Accepts expressions like "added >= 1", "afterCount === beforeCount", "changed > 0".
 * Whitelist-based: rejects any token that is not a known variable, digit, or safe operator.
 * Returns false on any parse/runtime error (fail closed).
 */
const SAFE_TOKENS = new Set([
  "(", ")", "+", "-", "*", "/",
  "===", "==", "!==", "!=", "<=", ">=", "<", ">",
  "&&", "||", "!",
]);

function safeEval(expr: string, ctx: Record<string, number>): boolean {
  const allowedVars = Object.keys(ctx);
  // Tokenize into identifiers, numbers, and operators
  const tokens = expr.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/<>=!&|]+|\s+/g) ?? [];
  // Validate each token
  for (const tok of tokens) {
    if (!tok.trim()) continue;
    if (/^[A-Za-z_]/.test(tok)) {
      if (!allowedVars.includes(tok)) return false;
    } else if (/^\d/.test(tok)) {
      // number literal – ok
    } else {
      if (!SAFE_TOKENS.has(tok)) return false;
    }
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...allowedVars, `"use strict"; return (${expr});`);
    const result = fn(...allowedVars.map((v) => ctx[v]));
    return Boolean(result);
  } catch {
    return false;
  }
}
