import type { Browser, Page } from "playwright";
import { config } from "../config/index.js";
import { PageProbe } from "../probes/pageProbe.js";
import { NetworkProbe } from "../probes/networkProbe.js";
import { DbProbe } from "../probes/dbProbe.js";
import { StateGraph } from "../state-graph/stateGraph.js";
import { createSession, closeSession } from "../actions/session.js";
import { assertActionAllowed } from "../guardrails/guardrails.js";
import type { Charter, CharterResult, StepRecord, VerdictLevel } from "./types.js";
import { createDecider, type AgentAction, type LlmClient } from "./llm.js";
import { Oracle } from "./oracle.js";

export class Explorer {
  private pageProbe = new PageProbe();
  private networkProbe = new NetworkProbe();
  private stateGraph = new StateGraph();
  private oracle: Oracle;
  private decider: LlmClient;

  constructor(
    private dbProbe: DbProbe | null,
    llmClient?: LlmClient,
  ) {
    this.oracle = new Oracle(dbProbe);
    this.decider = llmClient ?? createDecider();
  }

  async load(): Promise<void> {
    await this.stateGraph.load(config.run.stateGraphPath);
  }

  async runCharter(browser: Browser, charter: Charter): Promise<CharterResult> {
    const startedAt = new Date().toISOString();
    const maxSteps = charter.maxSteps ?? config.run.maxStepsPerCharter;
    const session = await createSession(browser, { traceName: charter.id });
    this.pageProbe.attach(session.page);
    this.networkProbe.attach(session.page);
    this.oracle.reset();
    await this.oracle.takeBeforeSnapshots(charter);

    const steps: StepRecord[] = [];
    const history: string[] = [];
    let verdict: VerdictLevel = "unconfirmed";
    let verdictReason = "max steps reached without conclusion";
    let lastFingerprint = "";

    try {
      await session.page.goto(charter.startUrl);

      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
        const observation = await this.pageProbe.observe(session.page);
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

        const action = await this.decider.decideNextAction({
          charter,
          observation,
          history,
          novelty: this.stateGraph.novelty(fingerprint),
        });

        if (action.kind === "done") {
          const finalCheck = await this.oracle.evaluateCharter(charter, observation, this.networkProbe);
          verdict = finalCheck.level;
          verdictReason = finalCheck.reason;
          break;
        }

        await this.perform(session.page, action);
        history.push(`${action.kind}:${action.targetName ?? action.url ?? ""}`);
      }
    } finally {
      const tracePath = await closeSession(session, charter.id);
      await this.stateGraph.save(config.run.stateGraphPath);

      const result: CharterResult = {
        charterId: charter.id,
        verdict,
        verdictReason,
        steps,
        evidence: {
          tracePath,
          screenshots: [],
          apiErrors: this.networkProbe.errors(),
          dbDiffs: this.oracle.collectedDiffs,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      this.networkProbe.reset();
      this.pageProbe.resetErrors();
      return result;
    }
  }

  private async perform(page: Page, action: AgentAction): Promise<void> {
    assertActionAllowed({ kind: action.kind, targetText: action.targetName, url: action.url });
    switch (action.kind) {
      case "click":
        await page.getByRole("button", { name: action.targetName, exact: false }).first()
          .click({ timeout: 3000 })
          .catch(() => page.getByText(action.targetName!, { exact: false }).first().click({ timeout: 3000 }));
        break;
      case "fill":
        await page.getByLabel(action.targetName!).fill(action.value ?? "");
        break;
      case "select":
        await page.getByLabel(action.targetName!).click();
        await page.getByRole("option", { name: action.value }).first().click();
        break;
      case "navigate":
        await page.goto(action.url!);
        break;
      case "assert-text":
        await page.getByText(action.value!, { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });
        break;
      default:
        break;
    }
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  }
}
