import { z } from "zod";

/** `status: "ok"` with the database check and version; `degraded` (HTTP 503) when the database is unreachable. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  db: z.literal("ok").optional(),
  version: z.string().optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthDegradedSchema = z.object({
  status: z.literal("degraded"),
  db: z.literal("down"),
});

export const instanceConfigSchema = z.object({
  signupMode: z.enum(["open", "closed"]),
  /** True when this instance can send email (SMTP configured). */
  emailConfigured: z.boolean(),
  /** True when reset links are written to the server log (no SMTP and KASH_LOG_RESET_LINKS). */
  resetLinksInLog: z.boolean(),
  /** True when unverified accounts are held at a verification gate. */
  emailVerificationRequired: z.boolean(),
  /** False when signups are closed and an account already exists. The first account can always be created. */
  signupAllowed: z.boolean(),
  version: z.string(),
});
export type InstanceConfig = z.infer<typeof instanceConfigSchema>;
