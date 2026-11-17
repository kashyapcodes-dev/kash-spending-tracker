import { z } from "zod";
import { roleSchema, uuidSchema } from "./common";

export const currencySchema = z
  .string()
  .max(3)
  .regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. USD");

export const budgetSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  currency: currencySchema,
  role: roleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Budget = z.infer<typeof budgetSchema>;

export const createBudgetBody = z.object({
  name: z.string().trim().min(2).max(200),
  currency: currencySchema.optional(),
});
export type CreateBudgetBody = z.infer<typeof createBudgetBody>;

export const updateBudgetBody = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    currency: currencySchema.optional(),
  })
  .refine(v => v.name !== undefined || v.currency !== undefined, {
    message: "Provide name or currency",
  });
export type UpdateBudgetBody = z.infer<typeof updateBudgetBody>;

export const budgetListSchema = z.object({ items: z.array(budgetSchema) });

export const meSchema = z.object({
  user: z.object({
    id: z.string().max(128),
    email: z.string().max(320),
    name: z.string().max(200),
    /** False while the address is unverified and REQUIRE_EMAIL_VERIFICATION is on. */
    emailVerified: z.boolean(),
  }),
  budgets: z.array(budgetSchema),
});
export type Me = z.infer<typeof meSchema>;
