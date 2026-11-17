import type { PageObservation } from "../probes/pageProbe.js";
import type { NetworkProbe } from "../probes/networkProbe.js";
import type { DbProbe, DbDiff, DbSnapshot } from "../probes/dbProbe.js";
import type { Charter, VerdictLevel } from "./types.js";

export interface Verdict {
  level: VerdictLevel;
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

  constructor(private dbProbe: DbProbe | null) {}

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
      pending.before = await this.dbProbe.snapshot(hint.description, hint.sql!);
    }
  }

  async evaluateCharter(charter: Charter, observation: PageObservation, network: NetworkProbe): Promise<Verdict> {
    for (const hint of charter.oracleHints) {
      if (hint.kind === "ui-text" && hint.expect) {
        if (!observation.visibleTextSample.includes(hint.expect)) {
          return { level: "fail", reason: `expected UI text not found: '${hint.expect}' (${hint.description})` };
        }
      }
      if (hint.kind === "api" && hint.expect) {
        const matched = network.calls.some((call) => call.path.includes(hint.expect!));
        if (!matched) {
          return { level: "fail", reason: `expected API call not observed: '${hint.expect}' (${hint.description})` };
        }
      }
      if (hint.kind === "db" && hint.sql && this.dbProbe) {
        const pending = this.pendingSnapshots.find((item) => charter.oracleHints[item.hintIndex] === hint);
        if (pending?.before) {
          const after = await this.dbProbe.snapshot(hint.description, hint.sql);
          const diff = this.dbProbe.diff(hint.description, pending.before, after, hint.keyField ?? "id");
          this.collectedDiffs.push(diff);
          if (diff.beforeCount === diff.afterCount && diff.added.length === 0 && diff.removed.length === 0) {
            return { level: "fail", reason: `expected DB change not observed: ${hint.description}` };
          }
        }
      }
    }
    return { level: "pass", reason: "all oracle hints satisfied" };
  }

  reset(): void {
    this.collectedDiffs.length = 0;
    this.pendingSnapshots = [];
  }
}
