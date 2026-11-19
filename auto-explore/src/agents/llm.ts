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
    "",
    "何时输出 done（最重要的判定信号）：",
    "- 你已经找到了与任务目标相关的页面（例如 Charter 要求验证'客户列表加载'，你已经在 /customer 看到了列表表格）",
    "- 你连续 2 次操作没有改变页面状态（点了但没反应、form-error 一直存在）",
    "- 页面上没有任何与目标相关的可交互元素了",
    "",
    "硬性要求：",
    "1. 只输出 JSON，不要输出任何其他文字。",
    '2. JSON 结构：{"kind":"click|fill|select|navigate|assert-text|done","targetName":"...","value":"...","url":"...","reason":"..."}。',
    "3. click/fill/select 必须给 targetName（使用页面上真实存在的元素名称）；navigate 必须给 url（站内相对路径）；assert-text 必须给 value。",
    "4. 填表单时使用有业务语义的测试数据，新建类数据加 AUTO- 前缀；涉及边界验证时使用空值、超长、特殊字符等。",
    "5. 严格遵守任务单 constraints；禁止点击系统管理、批量删除、清空类入口。",
    "6. 连续动作不要重复已经做过的（见历史记录）。",
    "7. 优先点击名字中包含'追加''新規''作成''編集''保存'等业务动词的按钮，它们通常是关键路径。",
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
          temperature: 0.0,
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

/**
 * Lightweight "knowledge-driven" heuristic explorer.
 *
 * Core idea: instead of hard-coding role whitelists, business-verb regexes,
 * and danger-words that break as soon as the SUT changes language or the UI
 * library, we extract *everything* we need at runtime:
 *
 *   - Charter.goal gives us business verbs (auto-translates CN/JP/EN)
 *   - Guardrails handle danger-words at the Explorer layer (don't duplicate here)
 *   - *every* interactive element on the page is a candidate — we just rank
 *     by how well it matches the Charter goal
 *
 * This means adding a new module never requires touching this class — write
 * a Charter JSON and the heuristic adapts automatically.
 */
export class HeuristicExplorer implements LlmClient {
  /**
   * Universal business-action verbs covering CN / JP / EN. Matched verbatim
   * against Charter.goal to extract charter-specific keywords. The Charter
   * author writes their goal in whatever language fits the SUT, and this
   * table (plus a Charter-specific match pass below) produces the ranking
   * signals.
   */
  private static readonly ALL_KNOWN_VERBS = [
    // Japanese
    "新規", "追加", "作成", "保存", "確定", "登録", "削除", "選択",
    "検索", "詳細", "編集", "更新", "承認", "出荷", "入荷",
    // Chinese
    "新建", "新增", "创建", "保存", "确认", "登记", "删除", "选择",
    "搜索", "详情", "编辑", "更新", "审批", "出货", "入库",
    // English
    "create", "new", "add", "save", "confirm", "register", "delete", "select",
    "search", "detail", "edit", "update", "approve", "ship", "receive",
  ];

  /**
   * Words we would *never* pick — defensive copy of what Guardrails already
   * blocks higher up. Unlike business verbs this is intentionally conservative:
   * if we match one of these, we *skip* the element entirely rather than rank it.
   */
  private static readonly DANGER_PATTERN =
    /削除|删除|truncate|清空|批量|bulk|reset|wipe|drop\s+table/i;

  async decideNextAction(input: DecideInput): Promise<AgentAction> {
    const { charter, observation, history, novelty } = input;

    // Normalise history so a failed click (recorded as "fail:click:X") and a
    // successful click ("ok:click:X" / legacy "click:X") are both excluded from
    // candidate consideration. Without this the heuristic would keep picking the
    // same button that perform() just failed on.
    const tried = new Set(
      history
        .filter((h) => /(?:ok:)?click:|fail:click:/.test(h))
        .map((h) => h.replace(/^(?:ok:|fail:)?click:/, "")),
    );

    // First-pass candidate filtering — no role whitelist. *Any* interactive
    // element on the page is fair game, provided Guardrails / danger-pattern
    // don't rule it out and we haven't already attempted it.
    const candidates = observation.interactive.filter(
      (el) =>
        el.name.trim().length > 0 &&
        !tried.has(el.name) &&
        !HeuristicExplorer.DANGER_PATTERN.test(el.name),
    );

    if (candidates.length === 0) {
      return { kind: "done", reason: "no unexplored interactive elements" };
    }

    // Extract charter-specific keywords from the goal. We intersect the Charter
    // author's own verbs with our universal table to get an ordered keyword
    // list that's tailored to *this* Charter. For example a Charter on 订单管理
    // ("新建订单：填入客户+品名") will yield ["新建", "品名", "订单"] and rank
    // elements containing those above generic buttons like "検索".
    const goalText = `${charter?.goal ?? ""} ${charter?.constraints?.join(" ") ?? ""}`;
    const charterKeywords = HeuristicExplorer.ALL_KNOWN_VERBS.filter((v) => goalText.includes(v));

    // Score candidates — higher wins.
    //   +3 if element name contains a Charter keyword (directly tied to goal)
    //   +2 if element role is button / link (primary business actions)
    //   +1 if element role is anything else but interactive (dialog trigger etc.)
    //   0 otherwise — still considered, but only as a last resort
    const scored = candidates.map((el) => {
      let score = 0;
      const hasKeyword = charterKeywords.some((kw) => el.name.includes(kw));
      if (hasKeyword) score += 3;
      if (el.role === "button" || el.role === "link") score += 2;
      else score += 1;
      return { el, score, hasKeyword };
    });
    scored.sort((a, b) => b.score - a.score);

    const picked = scored[0].el;
    const reasonParts: string[] = [];
    if (charterKeywords.length) reasonParts.push(`keywords=[${charterKeywords.join(",")}]`);
    if (scored[0].hasKeyword) reasonParts.push("goal-relevant element");
    reasonParts.push(`score=${scored[0].score}/${scored.length} candidates`);

    return {
      kind: "click",
      targetName: picked.name,
      reason: `heuristic ${reasonParts.join(", ")}`,
    };
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

/**
 * Pick the right decider for a Charter based on its priority.
 *   P0-conflict / P1-unconfirmed → LLM + heuristic fallback
 *       (These need intelligent value selection — e.g. "fill AUTO-DUP-*")
 *   P2-mainflow / P3-explore → pure HeuristicExplorer
 *       (Smoke paths only need "goto → wait → assert text" — zero LLM cost, fully deterministic)
 *
 * A Charter can opt out via `constraints: ["require-llm"]` to force LLM mode.
 */
export function createDeciderForCharter(charter: Charter): LlmClient {
  const { apiBase, apiKey, model } = config.llm;
  const priorityNeedsLlm = charter.priority === "P0-conflict" || charter.priority === "P1-unconfirmed";
  const forceLlm = charter.constraints.some((c) => c.toLowerCase().includes("require-llm"));
  if ((priorityNeedsLlm || forceLlm) && apiBase && apiKey && model) {
    console.log(`[decider] LLM mode for ${charter.id} (priority=${charter.priority})`);
    return new ResilientDecider(new HttpLlmClient(apiBase, apiKey, model), new HeuristicExplorer());
  }
  if (!apiBase || !apiKey || !model) {
    console.log(`[decider] heuristic mode for ${charter.id} (LLM not configured)`);
  } else {
    console.log(`[decider] heuristic mode for ${charter.id} (priority=${charter.priority} — smoke path, zero LLM cost)`);
  }
  return new HeuristicExplorer();
}
