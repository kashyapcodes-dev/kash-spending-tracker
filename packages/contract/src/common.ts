import { z } from "zod";

/** Largest amount storable in an `integer` column. */
export const MAX_AMOUNT_CENTS = 2_147_483_647;

/** True when `YYYY-MM-DD` is a real calendar date. Pure arithmetic: no time zone is involved. */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days =
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  return d <= days;
}

export const dateStringSchema = z
  .string()
  .max(10)
  .refine(isCalendarDate, {
    message: "Must be a calendar date in YYYY-MM-DD format",
  })
  .meta({ description: "Calendar date, YYYY-MM-DD", example: "2026-11-11" });

export const amountCentsSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_AMOUNT_CENTS)
  .meta({
    description: "Amount in integer minor units (cents). Always positive.",
  });

export const uuidSchema = z.uuid();

export const roleSchema = z.enum(["owner", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export const transactionTypeSchema = z.enum(["expense", "income"]);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export const errorCodeSchema = z.enum([
  "unauthenticated",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "payload_too_large",
  "rate_limited",
  "ai_not_configured",
  "encryption_not_configured",
  "provider_not_configured",
  "email_unverified",
  "internal",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  email_unverified: 403,
  ai_not_configured: 503,
  encryption_not_configured: 503,
  provider_not_configured: 503,
  internal: 500,
};

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
});

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const budgetIdParams = z.object({ budgetId: uuidSchema });
