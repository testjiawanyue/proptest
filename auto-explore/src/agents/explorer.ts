import type { Browser, Page } from "playwright";
import { access } from "node:fs/promises";
import { config } from "../config/index.js";
import { PageProbe } from "../probes/pageProbe.js";
import { NetworkProbe } from "../probes/networkProbe.js";
import { DbProbe } from "../probes/dbProbe.js";
import { StateGraph } from "../state-graph/stateGraph.js";
import { createSession, closeSession, login, saveStorageState } from "../actions/session.js";
import { assertActionAllowed, assertCharterSqlAllowed } from "../guardrails/guardrails.js";
import type { Charter, CharterResult, StepRecord, VerdictLevel } from "./types.js";
import { createDeciderForCharter, type AgentAction, type LlmClient } from "./llm.js";
import { Oracle } from "./oracle.js";

const MAX_CONSECUTIVE_ACTION_FAILURES = 5;
const HEURISTIC_UPGRADE_THRESHOLD = 3;  // 连续失败 3 次自动升 LLM

export class Explorer {
  private pageProbe = new PageProbe();
  private networkProbe = new NetworkProbe();
  private stateGraph = new StateGraph();
  private oracle: Oracle;

  constructor(
    private dbProbe: DbProbe | null,
  ) {
    this.oracle = new Oracle(dbProbe);
  }

  async load(): Promise<void> {
    await this.stateGraph.load(config.run.stateGraphPath);
  }

  async runCharter(browser: Browser, charter: Charter): Promise<CharterResult> {
    const startedAt = new Date().toISOString();
    const maxSteps = charter.maxSteps ?? config.run.maxStepsPerCharter;
    const decider = createDeciderForCharter(charter);

    // Pre-create an LLM decider we can fall *up* to if the heuristic gets stuck
    // (连续失败导致无法推进). Only useful when LLM is configured.
    const { apiBase, apiKey, model } = config.llm;
    const llmAvailable = !!(apiBase && apiKey && model);
    let heuristicUpgradedToLlm = false;

    const session = await createSession(browser, { traceName: charter.id });
    this.pageProbe.attach(session.page);
    this.networkProbe.attach(session.page);
    this.oracle.reset();
    this.oracle.setRunStartedAt(startedAt);

    // Reuse login state if available; otherwise auto-login
    const hasAuth = await access(config.run.storageStatePath).then(() => true).catch(() => false);
    if (hasAuth) {
      try { await session.context.addCookies(JSON.parse(require("fs").readFileSync(config.run.storageStatePath, "utf-8")).cookies); } catch { /* ignore */ }
    }
    // Navigate and wait for any SPA router redirect to settle
    await session.page.goto(charter.startUrl);
    await session.page.waitForLoadState("networkidle").catch(() => undefined);
    // If we landed on a login page, (re-)authenticate now
    if (session.page.url().includes("login")) {
      console.log(`[explorer] ${charter.id}: not logged in, auto-login`);
      await login(session.page);
      await saveStorageState(session);
      await session.page.goto(charter.startUrl);
      await session.page.waitForLoadState("networkidle").catch(() => undefined);
    }

    const steps: StepRecord[] = [];
    const history: string[] = [];
    const warnings: string[] = [];
    let verdict: VerdictLevel = "unconfirmed";
    let verdictReason = `max steps (${maxSteps}) reached without conclusion`;
    let lastFingerprint = "";
    let consecutiveActionFailures = 0;
    this.stateGraph.beginRun();

    try {
      await this.applyCharterSql(charter.setupSql, `${charter.id} setupSql`, startedAt);
      await this.oracle.takeBeforeSnapshots(charter);

      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
        // On step 0, re-verify we're actually past login. A stale cookie or a
        // session that got dropped between Charters can leave us on /login2
        // even though takeBeforeSnapshots already passed. If we're still on a
        // login page at this point, auto-login again and hop straight back to
        // the startUrl so the real observation is captured.
        if (stepIndex === 0 && session.page.url().includes("login")) {
          console.log(`[explorer] ${charter.id}: step 0 still on login page, re-authenticating`);
          await login(session.page);
          await saveStorageState(session);
          await session.page.goto(charter.startUrl);
        }

        let observation;
        try {
          observation = await this.pageProbe.observe(session.page);
        } catch (err) {
          warnings.push(`step ${stepIndex}: observe failed: ${(err as Error).message}`);
          continue;
        }

        const fingerprint = await this.pageProbe.fingerprint(session.page);
        const { isNew } = this.stateGraph.visit(fingerprint, observation.url, observation.heading);
        if (lastFingerprint && lastFingerprint !== fingerprint) {
          this.stateGraph.traverse(lastFingerprint, history.at(-1) ?? "goto", fingerprint);
        }
        lastFingerprint = fingerprint;

        const stepVerdict = await this.oracle.checkInvariants(charter, observation, this.networkProbe);
        steps.push({
          stepIndex,
          action: history.at(-1) ?? "goto",
          observationUrl: observation.url,
          heading: observation.heading,
          isNewState: isNew,
          apiErrors: this.networkProbe.errors().length,
          consoleErrors: observation.consoleErrors.length,
        });

        if (stepVerdict) {
          verdict = stepVerdict.level;
          verdictReason = stepVerdict.reason;
          break;
        }

        // Auto-short-circuit: evaluate oracle hints every step. If all hints are
        // satisfied we declare "done" immediately without waiting for the decider
        // to figure it out. If a hint is violated (e.g. no-api-call was called), fail fast.
        const hintCheck = await this.oracle.evaluateCharter(charter, observation, this.networkProbe);
        if (hintCheck.level === "pass") {
          verdict = "pass";
          verdictReason = `${hintCheck.reason} (auto-detected at step ${stepIndex})`;
          break;
        }
        if (hintCheck.level === "fail") {
          verdict = "fail";
          verdictReason = hintCheck.reason;
          break;
        }

        let action: AgentAction;
        try {
          action = await decider.decideNextAction({
            charter,
            observation,
            history,
            novelty: this.stateGraph.novelty(fingerprint),
          });
        } catch (err) {
          warnings.push(`step ${stepIndex}: decider failed: ${(err as Error).message}`);
          consecutiveActionFailures++;
          if (consecutiveActionFailures >= MAX_CONSECUTIVE_ACTION_FAILURES) {
            verdict = "unconfirmed";
            verdictReason = `${consecutiveActionFailures} consecutive decider failures`;
            break;
          }
          continue;
        }

        if (action.kind === "done") {
          const finalCheck = await this.oracle.evaluateCharter(charter, observation, this.networkProbe);
          verdict = finalCheck.level;
          verdictReason = finalCheck.reason;
          break;
        }

        const ok = await this.perform(session.page, action).catch((err) => {
          warnings.push(`step ${stepIndex}: perform ${action.kind} ${action.targetName ?? action.url ?? ""} threw: ${(err as Error).message}`);
          return false;
        });
        if (ok) {
          consecutiveActionFailures = 0;
          history.push(`ok:${action.kind}:${action.targetName ?? action.url ?? ""}`);
        } else {
          // perform() returned false — record the attempted action in history
          // with a "fail:" prefix so the next decider iteration (Heuristic or
          // LLM) knows *not* to pick it again. Without this, the heuristic
          // would keep selecting the same element forever when it's blocked by
          // an overlay or scrolled out of view.
          const attempted = `fail:${action.kind}:${action.targetName ?? action.url ?? ""}`;
          warnings.push(`step ${stepIndex}: perform ${action.kind} ${action.targetName ?? action.url ?? ""} — all locator strategies failed`);
          consecutiveActionFailures++;
          history.push(attempted);

          // Auto-upgrade: when the heuristic gets stuck on the same page and
          // keeps failing the same element, switch to the LLM decider for the
          // rest of this Charter. The LLM can read ariaSnapshot and figure out
          // things like "this button is behind a tab — click the tab first".
          if (
            !heuristicUpgradedToLlm &&
            consecutiveActionFailures >= HEURISTIC_UPGRADE_THRESHOLD &&
            llmAvailable
          ) {
            heuristicUpgradedToLlm = true;
            console.log(`[explorer] ${charter.id}: heuristic blocked (${consecutiveActionFailures} fails), upgrading to LLM decider`);
            const { HttpLlmClient } = await import("./llm.js");
            Object.assign(decider, new HttpLlmClient(apiBase!, apiKey!, model!));
          }

          if (consecutiveActionFailures >= MAX_CONSECUTIVE_ACTION_FAILURES) {
            verdict = "unconfirmed";
            verdictReason = `${consecutiveActionFailures} consecutive action failures; last: ${warnings.at(-1)}`;
            break;
          }
        }
      }
    } catch (err) {
      warnings.push(`FATAL: ${(err as Error).message}`);
      verdict = "unconfirmed";
      verdictReason = `unhandled error: ${(err as Error).message}`;
    } finally {
      try {
        await this.applyCharterSql(charter.cleanupSql, `${charter.id} cleanupSql`, startedAt);
      } catch (err) {
        warnings.push(`cleanup failed: ${(err as Error).message}`);
      }
      const tracePath = await closeSession(session, charter.id);
      const coverage = this.stateGraph.coverage();
      await this.stateGraph.save(config.run.stateGraphPath);

      const result: CharterResult = {
        charterId: charter.id,
        charterTitle: charter.title,
        verdict,
        verdictReason,
        steps,
        evidence: {
          tracePath,
          screenshots: [],
          apiErrors: this.networkProbe.errors(),
          dbDiffs: this.oracle.collectedDiffs,
          stateCoverage: coverage,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      if (warnings.length > 0) {
        (result.evidence as unknown as { warnings?: string[] }).warnings = warnings;
      }
      this.networkProbe.reset();
      this.pageProbe.resetErrors();
      return result;
    }
  }

  /**
   * Executes guarded fixture SQL. `{{runStartedAt}}` is rendered as a MySQL
   * datetime so cleanup can scope itself to rows created by this run.
   */
  private async applyCharterSql(statements: string[] | undefined, label: string, startedAt: string): Promise<void> {
    if (!statements?.length) return;
    if (!this.dbProbe) throw new Error(`${label}: DB probe is not available`);
    const runAt = new Date(startedAt).toISOString().slice(0, 19).replace("T", " ");
    for (const raw of statements) {
      const sql = raw.replaceAll("{{runStartedAt}}", `'${runAt}'`);
      assertCharterSqlAllowed(sql, config.run.allowCharterSql);
      await this.dbProbe.execute(sql);
      console.log(`[explorer] ${label}: ${sql.slice(0, 160)}`);
    }
  }

  /** Returns true if the action was applied successfully, false otherwise. Never throws. */
  private async perform(page: Page, action: AgentAction): Promise<boolean> {
    assertActionAllowed({ kind: action.kind, targetText: action.targetName, url: action.url });
    switch (action.kind) {
      case "click": {
        const name = action.targetName!;
        // Try multiple locator strategies in order of preference
        const tryLocators = [
          page.getByRole("button", { name, exact: false }).first(),
          page.getByRole("link", { name, exact: false }).first(),
          page.getByRole("menuitem", { name, exact: false }).first(),
          page.getByRole("tab", { name, exact: false }).first(),
          page.getByRole("switch", { name, exact: false }).first(),
          page.getByText(name, { exact: false }).first(),
          page.locator(`button, a, [role], span, div`).filter({ hasText: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first(),
        ];
        for (const loc of tryLocators) {
          try {
            await loc.click({ timeout: 2000 });
            await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
            return true;
          } catch { /* try next strategy */ }
        }
        return false;
      }
      case "fill": {
        const name = action.targetName!;
        const value = action.value ?? "";
        const tryLocators = [
          page.getByLabel(name, { exact: false }).first(),
          page.getByPlaceholder(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).first(),
          page.getByRole("textbox", { name, exact: false }).first(),
          page.locator(".ant-form-item").filter({ hasText: name }).locator("input").first(),
        ];
        for (const loc of tryLocators) {
          try {
            await loc.fill(value, { timeout: 2000 });
            return true;
          } catch { /* try next */ }
        }
        return false;
      }
      case "select": {
        const label = action.targetName!;
        const value = action.value!;
        try {
          await page.getByLabel(label, { exact: false }).first().click({ timeout: 2000 });
          await page.getByRole("option", { name: value, exact: false }).first().click({ timeout: 2000 });
          return true;
        } catch {
          return false;
        }
      }
      case "navigate": {
        try {
          await page.goto(action.url!, { timeout: 10000 });
          return true;
        } catch {
          return false;
        }
      }
      case "assert-text": {
        try {
          await page.getByText(action.value!, { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      }
      default:
        return false;
    }
  }
}
