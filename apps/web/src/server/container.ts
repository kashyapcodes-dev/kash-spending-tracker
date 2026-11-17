import {
  createAuth,
  createSecretBox,
  type SyncDeps,
  type BankDeps,
  createRateLimiter,
  parseTrustedProxy,
  type RateLimiter,
  type TrustedProxy,
  createServices,
  agentService,
  dailyLimitHook,
  type AgentService,
  type Auth,
  type Config,
  type Services,
} from "@kash/core";
import { createDb, type DbHandle } from "@kash/db";
import {
  FakeBank,
  FakeProvider,
  anthropicProvider,
  openaiProvider,
  DEFAULT_MODELS,
  say,
  callTool,
  type ChatProvider,
  fakeTx,
  plaidProvider,
  simplefinAllowedHosts,
  simplefinProvider,
} from "@kash/integrations";
import { readConfig } from "./env";
import { deliverInvite, deliverResetLink, deliverVerification } from "./mailer";

export interface Container {
  config: Config;
  db: DbHandle;
  auth: Auth;
  services: Services;
  limiter: RateLimiter;
  /** One-hour window, for limits such as 3 verification emails an hour. */
  hourlyLimiter: RateLimiter;
  trustedProxy: TrustedProxy;
  /** REQUIRE_EMAIL_VERIFICATION: unverified accounts are held at the gate. */
  requireVerification: boolean;
  appUrl: string;
  /** Present only when APP_ENCRYPTION_KEY is set. */
  syncDeps: SyncDeps | null;
  agent: AgentService;
  /** Only with AI_PROVIDER=fake (tests). */
  fakeProvider?: FakeProvider;
  /** Only with KASH_FAKE_BANK (tests). */
  fakeBank?: FakeBank;
}

const KEY = Symbol.for("kash.container");
type Holder = { [KEY]?: Container };

/** Composition root: one database pool, one auth instance, one set of services per process. */
export function getContainer(): Container {
  const holder = globalThis as Holder;
  if (holder[KEY]) return holder[KEY];
  const config = readConfig();
  const db = createDb(config.DATABASE_URL);
  const auth = createAuth({
    db: db.db,
    secret: config.AUTH_SECRET,
    baseURL: config.APP_URL,
    disableRateLimit: config.KASH_DISABLE_AUTH_RATE_LIMIT,
    signupMode: config.SIGNUP_MODE,
    sendResetPassword: ({ email, url }) => deliverResetLink(config, email, url),
    ...(config.REQUIRE_EMAIL_VERIFICATION
      ? {
          sendVerificationEmail: ({
            email,
            url,
          }: {
            email: string;
            url: string;
          }) => deliverVerification(config, email, url),
        }
      : {}),
  });
  const box = config.APP_ENCRYPTION_KEY
    ? createSecretBox(
        config.APP_ENCRYPTION_KEY,
        config.APP_ENCRYPTION_KEY_PREVIOUS,
      )
    : null;
  const providers: BankDeps["providers"] = {};
  let fakeBank: FakeBank | undefined;
  if (config.KASH_FAKE_BANK) {
    const bank = (fakeBank = new FakeBank());
    const today = new Date().toISOString().slice(0, 10);
    bank.queue.push({
      added: [
        fakeTx({
          externalId: "fk-1",
          name: "Fake Coffee",
          amountCents: 450,
          date: today,
        }),
        fakeTx({
          externalId: "fk-2",
          name: "Fake Groceries",
          amountCents: 1234,
          date: today,
        }),
        fakeTx({
          externalId: "fk-3",
          name: "Fake Lunch",
          amountCents: 800,
          date: today,
          pending: true,
        }),
      ],
      modified: [],
      removedIds: [],
      nextCursor: "fake-1",
    });
    providers.plaid = bank.provider("plaid");
    providers.simplefin = bank.provider("simplefin");
  } else {
    const plaid = plaidProvider({
      clientId: config.PLAID_CLIENT_ID,
      secret: config.PLAID_SECRET,
      env: config.PLAID_ENV,
    });
    if (plaid.isConfigured()) providers.plaid = plaid;
    providers.simplefin = simplefinProvider({
      allowedHosts: simplefinAllowedHosts(config.SIMPLEFIN_ALLOWED_HOSTS),
    });
  }
  let provider: ChatProvider | null = null;
  let fakeProvider: FakeProvider | undefined;
  switch (config.AI_PROVIDER) {
    case "anthropic":
      provider = anthropicProvider({ apiKey: config.ANTHROPIC_API_KEY ?? "" });
      break;
    case "openai":
      provider = openaiProvider({
        apiKey: config.OPENAI_API_KEY ?? "",
        baseUrl: "https://api.openai.com/v1",
      });
      break;
    case "ollama":
      provider = openaiProvider({
        id: "ollama",
        baseUrl: `${(config.OLLAMA_BASE_URL ?? "").replace(/\/$/, "")}/v1`,
      });
      break;
    case "fake":
      provider = fakeProvider = new FakeProvider(scriptedReply);
      break;
  }
  const model =
    config.AI_MODEL ??
    (config.AI_PROVIDER
      ? (DEFAULT_MODELS[config.AI_PROVIDER] ?? null)
      : null) ??
    (config.AI_PROVIDER === "fake" ? "fake-model" : null);
  const syncDeps: SyncDeps | null = box ? { box, providers } : null;
  const container: Container = {
    config,
    db,
    auth,
    agent: agentService(db.db, {
      provider: model ? provider : null,
      model,
      usage: dailyLimitHook(db.db, config.AI_DAILY_MESSAGE_LIMIT),
    }),
    services: createServices(
      db.db,
      {
        appUrl: config.APP_URL,
        emailConfigured: config.emailConfigured,
        sendInvite: mail => deliverInvite(config, mail),
      },
      {
        box,
        providers,
        enqueueSync: async id => {
          const { enqueueSync } = await import("./queue");
          await enqueueSync(config, id);
        },
      },
    ),
    syncDeps,
    ...(fakeBank ? { fakeBank } : {}),
    ...(fakeProvider ? { fakeProvider } : {}),
    limiter: createRateLimiter({
      enabled: !config.KASH_DISABLE_AUTH_RATE_LIMIT,
    }),
    hourlyLimiter: createRateLimiter({
      enabled: !config.KASH_DISABLE_AUTH_RATE_LIMIT,
      windowMs: 3_600_000,
    }),
    trustedProxy: parseTrustedProxy(config.TRUSTED_PROXY),
    requireVerification: config.REQUIRE_EMAIL_VERIFICATION,
    appUrl: config.APP_URL,
  };
  holder[KEY] = container;
  return container;
}

/** Test hook: drop the cached container (the caller closes the pool). */
export function resetContainer(): void {
  delete (globalThis as Holder)[KEY];
}

/**
 * Replies of the scripted model (AI_PROVIDER=fake, tests and end-to-end runs only). It reacts to
 * a few fixed phrases and reads earlier tool results, so browser tests are deterministic.
 */
function scriptedReply(req: Parameters<FakeProvider["streamChat"]>[0]) {
  const msgs = req.messages;
  let at = -1;
  msgs.forEach((m, i) => {
    if (m.role === "user") at = i;
  });
  const first = msgs[at];
  const text = first?.role === "user" ? first.content.toLowerCase() : "";
  const results = msgs.slice(at + 1).flatMap(m => {
    if (m.role !== "tool") return [];
    try {
      return [{ name: m.name, data: JSON.parse(m.content) as any }]; // eslint-disable-line @typescript-eslint/no-explicit-any -- scripted test model
    } catch {
      return [];
    }
  });
  const got = (name: string) => results.find(r => r.name === name)?.data;
  const cat = (name: string): string | undefined =>
    got("list_categories")?.categories?.find(
      (c: { name: string }) => c.name.toLowerCase() === name,
    )?.id;

  if (text.includes("groceries") && text.includes("last month")) {
    if (!got("list_categories")) return callTool("c1", "list_categories", {});
    const id = cat("groceries");
    if (!got("run_query"))
      return callTool("c2", "run_query", {
        queries: [
          {
            version: 1,
            source: "transactions",
            filters: {
              type: "expense",
              ...(id ? { categoryIds: [id] } : {}),
              dateRange: { preset: "last_month" },
            },
            groupBy: "none",
            measure: "sum",
          },
        ],
      });
    const cents = got("run_query")?.results?.[0]?.series?.[0]?.value ?? 0;
    return say(
      "You spent $" + (cents / 100).toFixed(2) + " on groceries last month.",
    );
  }
  if (text.includes("recategor")) {
    if (!got("list_categories")) return callTool("r1", "list_categories", {});
    if (!got("query_transactions"))
      return callTool("r2", "query_transactions", { text: "blue bottle" });
    if (!got("propose_change")) {
      const coffee = cat("coffee");
      const rows: { id: string }[] =
        got("query_transactions").transactions ?? [];
      return callTool("r3", "propose_change", {
        summary: "Move coffee purchases to the Coffee category",
        operations: rows.map(r => ({
          op: "transaction.update",
          id: r.id,
          data: { categoryId: coffee ?? null },
        })),
      });
    }
    return say("I proposed that change. Approve it below.");
  }
  if (text.includes("chart")) {
    if (!got("create_widget"))
      return callTool("w1", "create_widget", {
        spec: {
          version: 1,
          type: "stat",
          title: "Total spending",
          query: {
            version: 1,
            source: "transactions",
            filters: { type: "expense" },
            groupBy: "none",
            measure: "sum",
          },
          display: { format: "currency" },
        },
      });
    return say("Here is the chart.");
  }
  if (text.includes("html"))
    return say(
      'Here: <img src="http://127.0.0.1:9/pixel.png"> and ![x](http://127.0.0.1:9/p.png) <script>alert(1)</script>',
    );
  return say("I can answer questions about your budget.");
}
