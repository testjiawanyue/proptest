// Offline unit checks for the LLM client plumbing. Injects dummy env vars so
// config/index.ts loads without a real .env, then exercises pure functions.
process.env.APP_BASE_URL ??= "http://localhost";
process.env.APP_LOGIN_USER ??= "selftest";
process.env.APP_LOGIN_PASSWORD ??= "selftest";
process.env.DB_HOST ??= "127.0.0.1";
process.env.DB_USER ??= "selftest";
process.env.DB_PASSWORD ??= "selftest";
process.env.DB_NAME ??= "prop-test";

const { parseAgentAction, buildSystemPrompt, buildUserPrompt, ResilientDecider } = await import("../src/agents/llm.js");
const { config } = await import("../src/config/index.js");

let failures = 0;
function check(name: string, fn: () => void | Promise<void>): void {
  void (async () => {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}: ${(error as Error).message}`);
    }
  })();
}
function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

check("parse plain json", () => {
  const action = parseAgentAction('{"kind":"click","targetName":"客户管理","reason":"go"}');
  expect(action.kind === "click" && action.targetName === "客户管理", "fields mismatch");
});

check("parse json wrapped in code fence", () => {
  const action = parseAgentAction('```json\n{"kind":"done","reason":"finished"}\n```');
  expect(action.kind === "done", "kind mismatch");
});

check("reject invalid kind", () => {
  let threw = false;
  try { parseAgentAction('{"kind":"delete-everything"}'); } catch { threw = true; }
  expect(threw, "should reject unknown kind");
});

check("reject click without target", () => {
  let threw = false;
  try { parseAgentAction('{"kind":"click"}'); } catch { threw = true; }
  expect(threw, "should require targetName");
});

check("reject non-json", () => {
  let threw = false;
  try { parseAgentAction("I think we should click the button"); } catch { threw = true; }
  expect(threw, "should reject prose");
});

check("heuristic mode when llm not configured", () => {
  expect(config.llm.apiBase === "", "dummy env should not set llm");
});

const charter = {
  id: "T", title: "t", priority: "P3-explore", goal: "验证看板加载",
  linkedReqIds: ["REQ-002"], linkedBrIds: [], linkedCaseIds: [],
  startUrl: "/", constraints: ["只读"], oracleHints: [], maxSteps: 5,
} as const;
const observation = {
  url: "http://localhost/", title: "首页", heading: "首页",
  ariaSnapshot: "", interactive: [{ role: "link", name: "客户管理" }],
  visibleTextSample: "订单统计", consoleErrors: [], pageErrors: [],
  capturedAt: new Date().toISOString(),
};
const input = { charter, observation, history: ["click:首页"], novelty: 0.5 };

check("prompt contains goal, constraints, elements, history", () => {
  const prompt = buildUserPrompt(input as never);
  expect(prompt.includes("验证看板加载"), "missing goal");
  expect(prompt.includes("只读"), "missing constraint");
  expect(prompt.includes("客户管理"), "missing element");
  expect(prompt.includes("click:首页"), "missing history");
  expect(buildSystemPrompt().includes("只输出 JSON"), "missing format rule");
});

check("resilient decider falls back after primary failure", async () => {
  const primary = { decideNextAction: async (): Promise<never> => { throw new Error("boom"); } };
  const fallback = { decideNextAction: async () => ({ kind: "done" as const, reason: "fb" }) };
  const decider = new ResilientDecider(primary, fallback);
  const action = await decider.decideNextAction(input as never);
  expect(action.kind === "done" && action.reason === "fb", "should use fallback");
});

setTimeout(() => {
  if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
  console.log("all selftest checks passed");
}, 500);

export {};
