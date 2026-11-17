/**
 * The one place the process environment is described and validated (M2).
 * Nothing else reads `process.env`; a test enforces that.
 */
import { z } from "zod";

const boolish = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform(v =>
      v === undefined || v === "" ? fallback : v === "true" || v === "1",
    );

const optionalString = z
  .string()
  .optional()
  .transform(v => (v === "" ? undefined : v));

/** Values that must never be used as a real secret (they appear in `.env.example`). */
const PLACEHOLDER = /^(replace-me|changeme|change-me|secret$)/i;

export const envSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .regex(
        /^postgres(ql)?:\/\/.+/,
        "must be a postgres:// connection string",
      ),
    /** Migrations run as the schema owner (ADR-0014). Unset: DATABASE_URL is used, with a warning. */
    DATABASE_MIGRATION_URL: z.preprocess(
      v => (v === "" ? undefined : v),
      z
        .string()
        .regex(/^postgres(ql)?:\/\/.+/)
        .optional(),
    ),
    /** pg-boss connects here and works in its own schema. Unset: the migration or app URL. */
    DATABASE_JOBS_URL: z.preprocess(
      v => (v === "" ? undefined : v),
      z
        .string()
        .regex(/^postgres(ql)?:\/\/.+/)
        .optional(),
    ),
    APP_URL: z.url().default("http://localhost:3000"),
    AUTH_SECRET: z
      .string()
      .min(
        32,
        "must be at least 32 characters (generate one with: openssl rand -base64 32)",
      )
      .refine(
        v => !PLACEHOLDER.test(v),
        "is still the placeholder value from .env.example",
      ),
    AUTO_MIGRATE: boolish(true),
    SIGNUP_MODE: z.enum(["open", "closed"]).default("open"),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(
      v => (v === "" ? undefined : v),
      z.coerce.number().int().min(1).max(65535).optional(),
    ),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM: optionalString,
    /** 32 random bytes, base64 (ADR-0005). Optional: without it bank connections are unavailable. */
    APP_ENCRYPTION_KEY: optionalString,
    APP_ENCRYPTION_KEY_PREVIOUS: optionalString,
    WORKER_MODE: z.enum(["inline", "separate", "off"]).default("inline"),
    BANK_SYNC_CRON: z.string().min(1).default("0 */6 * * *"),
    PLAID_CLIENT_ID: optionalString,
    PLAID_SECRET: optionalString,
    PLAID_ENV: z
      .enum(["sandbox", "development", "production"])
      .default("sandbox"),
    /** `none`, `loopback`, or a CIDR list: which proxies may set X-Forwarded-For (ADR-0013). */
    TRUSTED_PROXY: z.string().default("none"),
    PLAID_WEBHOOKS: boolish(false),
    /** Extra hosts (comma separated) allowed for SimpleFIN setup and access URLs. */
    SIMPLEFIN_ALLOWED_HOSTS: optionalString,
    /** Test only: replaces Plaid and SimpleFIN with a scripted fake bank. */
    KASH_FAKE_BANK: boolish(false),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    /** Unset disables AI entirely. `fake` is a scripted provider for tests. */
    AI_PROVIDER: z.preprocess(
      v => (v === "" ? undefined : v),
      z.enum(["anthropic", "openai", "ollama", "fake"]).optional(),
    ),
    AI_MODEL: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    OLLAMA_BASE_URL: z.preprocess(
      v => (v === "" ? undefined : v),
      z.url().optional(),
    ),
    /** Messages per user per day across the instance's provider. Unset: unlimited. */
    AI_DAILY_MESSAGE_LIMIT: z.preprocess(
      v => (v === "" ? undefined : v),
      z.coerce.number().int().min(1).optional(),
    ),
    /** Self-host only: with no SMTP, write password-reset links to the server log. Off by default. */
    KASH_LOG_RESET_LINKS: boolish(false),
    /** Opt in to email verification. Refused unless SMTP (or the test mail file) is configured. */
    REQUIRE_EMAIL_VERIFICATION: boolish(false),
    /** Test only: append password-reset emails to this file as JSON lines. */
    KASH_MAIL_FILE: optionalString,
    /** Test only: Better Auth rate-limits sign-in and sign-up per IP; end-to-end tests share one IP. */
    KASH_DISABLE_AUTH_RATE_LIMIT: boolish(false),
  })
  .superRefine((env, ctx) => {
    for (const name of [
      "APP_ENCRYPTION_KEY",
      "APP_ENCRYPTION_KEY_PREVIOUS",
    ] as const) {
      const v = env[name];
      if (v && Buffer.from(v, "base64").length !== 32)
        ctx.addIssue({
          code: "custom",
          path: [name],
          message:
            "must be 32 bytes, base64-encoded (generate with: openssl rand -base64 32)",
        });
    }
    const need: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      ollama: "OLLAMA_BASE_URL",
    };
    const key = env.AI_PROVIDER ? need[env.AI_PROVIDER] : undefined;
    if (key && !env[key as keyof typeof env])
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `is required when AI_PROVIDER=${env.AI_PROVIDER}`,
      });
    if (env.REQUIRE_EMAIL_VERIFICATION && !env.SMTP_HOST && !env.KASH_MAIL_FILE)
      ctx.addIssue({
        code: "custom",
        path: ["REQUIRE_EMAIL_VERIFICATION"],
        message:
          "needs SMTP_HOST: verification emails cannot be sent without it",
      });
    if (env.SMTP_HOST && !env.SMTP_FROM) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_FROM"],
        message: "is required when SMTP_HOST is set",
      });
    }
  });

export type Config = z.infer<typeof envSchema> & {
  emailConfigured: boolean;
  aiConfigured: boolean;
  encryptionConfigured: boolean;
};

/** Raised when the environment is invalid. The message names every offending variable. */
export class ConfigError extends Error {
  constructor(readonly problems: { variable: string; message: string }[]) {
    super(
      `Invalid configuration:\n${problems.map(p => `  ${p.variable}: ${p.message}`).join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map(i => ({
        variable: String(i.path[0] ?? "environment"),
        message:
          i.code === "invalid_type" && env[String(i.path[0])] === undefined
            ? "is required"
            : i.message,
      })),
    );
  }
  return {
    ...parsed.data,
    emailConfigured: Boolean(parsed.data.SMTP_HOST),
    aiConfigured: Boolean(parsed.data.AI_PROVIDER),
    encryptionConfigured: Boolean(parsed.data.APP_ENCRYPTION_KEY),
  };
}

/** Names of every variable the app reads, for the documentation check (M2-DOC-1). */
export const ENV_VARIABLES = Object.keys(envSchema.shape);
