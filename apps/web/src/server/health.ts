import {
  instanceConfigSchema,
  type HealthResponse,
  type InstanceConfig,
} from "@kash/contract";
import { isSignupAllowed } from "@kash/core";
import { getContainer } from "./container";
import { APP_VERSION } from "./version";

const DB_TIMEOUT_MS = 2000;

/** `select 1` with a timeout. Never leaks the error: callers only learn up or down. */
async function dbUp(): Promise<boolean> {
  try {
    const { pool } = getContainer().db;
    await Promise.race([
      pool.query("select 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function checkHealth(): Promise<
  | { status: 200; body: HealthResponse }
  | { status: 503; body: { status: "degraded"; db: "down" } }
> {
  return (await dbUp())
    ? { status: 200, body: { status: "ok", db: "ok", version: APP_VERSION } }
    : { status: 503, body: { status: "degraded", db: "down" } };
}

export async function readInstanceConfig(): Promise<InstanceConfig> {
  const { config, db } = getContainer();
  return instanceConfigSchema.parse({
    signupMode: config.SIGNUP_MODE,
    emailConfigured: config.emailConfigured,
    resetLinksInLog:
      !config.emailConfigured &&
      (config.KASH_LOG_RESET_LINKS || Boolean(config.KASH_MAIL_FILE)),
    emailVerificationRequired: config.REQUIRE_EMAIL_VERIFICATION,
    signupAllowed: await isSignupAllowed(db.db, config.SIGNUP_MODE),
    version: APP_VERSION,
  });
}
