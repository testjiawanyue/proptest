import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it.`);
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  app: {
    baseUrl: required("APP_BASE_URL").replace(/\/$/, ""),
    apiPrefix: optional("APP_API_PREFIX", "/prod-api"),
    loginUser: required("APP_LOGIN_USER"),
    loginPassword: required("APP_LOGIN_PASSWORD"),
    envFingerprint: optional("APP_ENV_FINGERPRINT"),
  },
  db: {
    host: required("DB_HOST"),
    port: Number(optional("DB_PORT", "3306")),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database: required("DB_NAME"),
  },
  run: {
    headless: optional("HEADLESS", "true") === "true",
    maxStepsPerCharter: Number(optional("MAX_STEPS_PER_CHARTER", "40")),
    traceDir: optional("TRACE_DIR", "reports/traces"),
    reportsDir: "reports",
    storageStatePath: "storage/auth.json",
    stateGraphPath: "storage/state-graph.json",
  },
  llm: {
    apiBase: optional("LLM_API_BASE"),
    apiKey: optional("LLM_API_KEY"),
    model: optional("LLM_MODEL"),
  },
} as const;

export type AppConfig = typeof config;
