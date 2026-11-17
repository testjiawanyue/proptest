import { config } from "../config/index.js";
import type { PageObservation } from "../probes/pageProbe.js";
import type { Charter } from "./types.js";

export interface AgentAction {
  kind: "click" | "fill" | "select" | "navigate" | "assert-text" | "done";
  targetName?: string;
  value?: string;
  url?: string;
  reason: string;
}

export interface DecideInput {
  charter: Charter;
  observation: PageObservation;
  history: string[];
  novelty: number;
}

export interface LlmClient {
  decideNextAction(input: DecideInput): Promise<AgentAction>;
}

const ACTION_KINDS = ["click", "fill", "select", "navigate", "assert-text", "done"] as const;

export function parseAgentAction(raw: string): AgentAction {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM output is not valid JSON: ${cleaned.slice(0, 120)}`);
  }
  const action = parsed as Partial<AgentAction>;
  if (!action.kind || !(ACTION_KINDS as readonly string[]).includes(action.kind)) {
    throw new Error(`LLM output has invalid kind: '${String(action.kind)}'`);
  }
  const needsTarget = ["click", "fill", "select"].includes(action.kind);
  if (needsTarget && !action.targetName) throw new Error(`action '${action.kind}' requires targetName`);
  if (action.kind === "navigate" && !action.url) throw new Error("action 'navigate' requires url");
  if (action.kind === "assert-text" && !action.value) throw new Error("action 'assert-text' requires value");
  return {
    kind: action.kind,
    targetName: action.targetName?.slice(0, 120),
    value: action.value?.slice(0, 500),
    url: action.url?.slice(0, 300),
    reason: (action.reason ?? "").slice(0, 200),
  };
}

export function buildSystemPrompt(): string {
  return [
    "你是一名 Web 系统探索式测试 Agent，正在测试 PROP 气囊管理系统（RuoYi-Vue 管理后台）。",
    "每一步你会收到：任务单目标与约束、当前页面的无障碍树摘要、可交互元素、已执行动作历史、当前状态新颖度。",
    "你的职责：围绕任务单目标选择下一步动作；优先走没走过的路径；发现目标已达成或无法推进时用 done 结束。",
    "硬性要求：",
    "1. 只输出 JSON，不要输出任何其他文字。",
    '2. JSON 结构：{"kind":"click|fill|select|navigate|assert-text|done","targetName":"...","value":"...","url":"...","reason":"..."}。',
    "3. click/fill/select 必须给 targetName（使用页面上真实存在的元素名称）；navigate 必须给 url（站内相对路径）；assert-text 必须给 value。",
    "4. 填表单时使用有业务语义的测试数据，新建类数据加 AUTO- 前缀；涉及边界验证时使用空值、超长、特殊字符等。",
    "5. 严格遵守任务单 constraints；禁止点击系统管理、批量删除、清空类入口。",
    "6. 连续动作不要重复已经做过的（见历史记录）。",
  ].join("\n");
}

export function buildUserPrompt(input: DecideInput): string {
  const { charter, observation, history, novelty } = input;
  const lines: string[] = [
    "## 任务单",
    `目标：${charter.goal}`,
    `约束：${charter.constraints.join("；") || "无"}`,
    `关联需求：${charter.linkedReqIds.join(",") || "无"}；关联用例：${charter.linkedCaseIds.join(",") || "无"}`,
    "",
    "## 当前页面",
    `URL：${observation.url}`,
    `标题：${observation.heading ?? observation.title}`,
    `可见文本摘要：${observation.visibleTextSample.slice(0, 400)}`,
    `可交互元素：${observation.interactive.map((el) => `${el.role}:"${el.name}"`).join("、") || "（无）"}`,
    `页面异常：console错误${observation.consoleErrors.length}条，未捕获异常${observation.pageErrors.length}条`,
    "",
    "## 探索状态",
    `已执行动作（最近10条）：${history.slice(-10).join(" -> ") || "（刚开始）"}`,
    `当前状态新颖度：${novelty.toFixed(2)}（1=全新状态，越小越常访问）`,
    "",
    "请输出下一步动作的 JSON。",
  ];
  return lines.join("\n");
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * OpenAI-compatible chat-completions client. Retries once on network/parse
 * failure, then throws so ResilientDecider can fall back to the heuristic.
 */
export class HttpLlmClient implements LlmClient {
  constructor(
    private apiBase: string,
    private apiKey: string,
    private model: string,
    private timeoutMs = 30000,
  ) {}

  async decideNextAction(input: DecideInput): Promise<AgentAction> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content = await this.call(input, attempt > 0);
        return parseAgentAction(content);
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw lastError ?? new Error("LLM call failed");
  }

  private async call(input: DecideInput, strict: boolean): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const userPrompt = strict
        ? `${buildUserPrompt(input)}\n\n上次输出无法解析。只输出符合结构要求的 JSON，不要任何解释。`
        : buildUserPrompt(input);
      const response = await fetch(`${this.apiBase.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`LLM API ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("LLM API returned empty content");
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class HeuristicExplorer implements LlmClient {
  async decideNextAction(input: DecideInput): Promise<AgentAction> {
    const { observation, history } = input;
    const untried = observation.interactive.find(
      (el) =>
        ["link", "menuitem", "tab"].includes(el.role) && !history.includes(`click:${el.name}`),
    );
    if (untried) {
      return { kind: "click", targetName: untried.name, reason: "breadth-first unexplored element" };
    }
    return { kind: "done", reason: "no unexplored interactive elements" };
  }
}

/**
 * Uses the LLM when healthy; falls back to the heuristic on failure.
 * After 3 consecutive LLM failures it stays on the heuristic for the rest
 * of the session to avoid burning budget on a broken endpoint.
 */
export class ResilientDecider implements LlmClient {
  private consecutiveFailures = 0;

  constructor(
    private primary: LlmClient,
    private fallback: LlmClient,
  ) {}

  async decideNextAction(input: DecideInput): Promise<AgentAction> {
    if (this.consecutiveFailures >= 3) {
      return this.fallback.decideNextAction(input);
    }
    try {
      const action = await this.primary.decideNextAction(input);
      this.consecutiveFailures = 0;
      return action;
    } catch (error) {
      this.consecutiveFailures += 1;
      console.warn(`[decider] LLM failed (${this.consecutiveFailures}/3), fallback to heuristic: ${(error as Error).message}`);
      return this.fallback.decideNextAction(input);
    }
  }
}

export function createDecider(): LlmClient {
  const { apiBase, apiKey, model } = config.llm;
  if (apiBase && apiKey && model) {
    console.log(`[decider] LLM mode: ${model} @ ${apiBase}`);
    return new ResilientDecider(new HttpLlmClient(apiBase, apiKey, model), new HeuristicExplorer());
  }
  console.log("[decider] heuristic mode (LLM not configured)");
  return new HeuristicExplorer();
}
