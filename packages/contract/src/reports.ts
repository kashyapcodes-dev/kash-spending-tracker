import { z } from "zod";
import { dateStringSchema, uuidSchema } from "./common";

const rangeSchema = z.object({
  from: dateStringSchema,
  to: dateStringSchema,
  days: z.number().int(),
});

export const summaryQuery = z.object({
  from: dateStringSchema,
  to: dateStringSchema,
  excludeCategoryIds: z
    .string()
    .max(50 * 37)
    .optional()
    .transform(v => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(uuidSchema)),
});

export const summaryResponse = z.object({
  range: rangeSchema,
  totals: z.object({
    incomeCents: z.number().int(),
    expenseCents: z.number().int(),
    netCents: z.number().int(),
    expenseCount: z.number().int(),
    excludedExpenseCount: z.number().int(),
    avgExpensePerDayCents: z.number().int(),
  }),
  categories: z.array(
    z.object({
      categoryId: uuidSchema.nullable(),
      name: z.string(),
      totalCents: z.number().int(),
      expenseCount: z.number().int(),
      excluded: z.boolean(),
    }),
  ),
});
export type SummaryResponse = z.infer<typeof summaryResponse>;

export const compareQuery = z.object({
  aFrom: dateStringSchema,
  aTo: dateStringSchema,
  bFrom: dateStringSchema,
  bTo: dateStringSchema,
});

const periodTotals = z.object({
  incomeCents: z.number().int(),
  expenseCents: z.number().int(),
  netCents: z.number().int(),
  incomeCount: z.number().int(),
  expenseCount: z.number().int(),
  avgExpenseCents: z.number().int(),
  avgIncomeCents: z.number().int(),
  avgExpensePerDayCents: z.number().int(),
  days: z.number().int(),
});

const categorySummary = z.object({
  categoryId: uuidSchema.nullable(),
  name: z.string(),
  totalCents: z.number().int(),
  count: z.number().int(),
  averageCents: z.number().int(),
});

const topExpense = z.object({
  id: uuidSchema,
  name: z.string(),
  amountCents: z.number().int(),
  date: dateStringSchema,
  categoryId: uuidSchema.nullable(),
});

const period = z.object({
  range: rangeSchema,
  totals: periodTotals,
  categorySummary: z.array(categorySummary),
  topExpenses: z.array(topExpense),
});

export const compareResponse = z.object({
  periodA: period,
  periodB: period,
  comparison: z.object({
    totalsDelta: z.object({
      incomeCents: z.number().int(),
      expenseCents: z.number().int(),
      netCents: z.number().int(),
      /** (B - A) / A as a fraction; null when A is zero. */
      expensePct: z.number().nullable(),
    }),
    categories: z.array(
      z.object({
        categoryId: uuidSchema.nullable(),
        name: z.string(),
        periodA: categorySummary.nullable(),
        periodB: categorySummary.nullable(),
        delta: z.object({
          totalCents: z.number().int(),
          totalPct: z.number().nullable(),
        }),
      }),
    ),
  }),
});
export type CompareResponse = z.infer<typeof compareResponse>;
