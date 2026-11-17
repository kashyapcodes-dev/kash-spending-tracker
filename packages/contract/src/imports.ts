import { z } from "zod";
import { dateStringSchema, uuidSchema } from "./common";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;

export const csvCandidateSchema = z.object({
  name: z.string(),
  amountCents: z.number().int(),
  date: dateStringSchema,
  suggestedCategoryId: uuidSchema.nullable(),
});

export const importIssueSchema = z.object({
  level: z.enum(["error", "warning"]),
  row: z.number().int(),
  name: z.string().nullable(),
  field: z.string().nullable(),
  message: z.string(),
});

export const csvPreviewResponse = z.object({
  preset: z.string(),
  candidates: z.array(csvCandidateSchema),
  issues: z.array(importIssueSchema),
});
export type CsvPreviewResponse = z.infer<typeof csvPreviewResponse>;

// ---------- M5: mapping, staging, presets ----------

export const DELIMITERS = [",", ";", "\t", "|"] as const;
export const DATE_FORMATS = [
  "auto",
  "MM/dd/yyyy",
  "dd/MM/yyyy",
  "M/d/yyyy",
  "d/M/yyyy",
  "yyyy-MM-dd",
  "dd.MM.yyyy",
  "MM/dd/yy",
  "dd/MM/yy",
] as const;

const columnName = z.string().min(1).max(200);
/** A saved column mapping. With `hasHeader: false`, columns are 1-based numbers as text ("1"). */
export const csvMappingSchema = z
  .strictObject({
    version: z.literal(1).default(1),
    hasHeader: z.boolean(),
    delimiter: z.enum(DELIMITERS),
    columns: z.strictObject({
      date: columnName,
      name: columnName,
      amount: columnName.nullish(),
      debit: columnName.nullish(),
      credit: columnName.nullish(),
    }),
    dateFormat: z.enum(DATE_FORMATS),
    amountSign: z.enum(["positive_is_expense", "negative_is_expense"]),
    importIncome: z.boolean(),
  })
  .superRefine((m, ctx) => {
    const { amount, debit, credit } = m.columns;
    if (amount && (debit || credit))
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message:
          "Use either an amount column or debit/credit columns, not both",
      });
    if (!amount && !debit && !credit)
      ctx.addIssue({
        code: "custom",
        path: ["columns", "amount"],
        message: "Map an amount column or a debit/credit column",
      });
  });
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export const presetSchema = z.object({
  id: z.string(),
  name: z.string(),
  institution: z.string().nullable(),
  builtIn: z.boolean(),
  mapping: csvMappingSchema,
});
export type ImportPreset = z.infer<typeof presetSchema>;
export const presetListSchema = z.object({ items: z.array(presetSchema) });
export const presetParams = z.object({
  budgetId: uuidSchema,
  presetId: z.string().min(1).max(100),
});
export const createPresetBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  mapping: csvMappingSchema,
});
export const updatePresetBody = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    mapping: csvMappingSchema.optional(),
  })
  .refine(v => v.name !== undefined || v.mapping !== undefined, {
    message: "Provide name or mapping",
  });

export const csvAnalyzeResponse = z.object({
  delimiter: z.enum(DELIMITERS),
  headers: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  rowCount: z.number().int(),
  preset: presetSchema.nullable(),
});
/** Multipart: `file`, and for stage either `mapping` (JSON text) or `presetId`, plus optional `label`. */
export const stagedSchema = z.object({
  id: uuidSchema,
  batchId: uuidSchema,
  bankAccountId: uuidSchema.nullable(),
  source: z.enum(["csv", "plaid", "simplefin"]),
  type: z.enum(["expense", "income"]),
  name: z.string(),
  amountCents: z.number().int(),
  date: dateStringSchema,
  suggestedCategoryId: uuidSchema.nullable(),
  status: z.enum(["pending", "accepted", "dismissed"]),
  duplicateConfidence: z.enum(["exact", "likely"]).nullable(),
  duplicateOf: z
    .object({
      id: uuidSchema,
      name: z.string(),
      date: dateStringSchema,
      amountCents: z.number().int(),
    })
    .nullable(),
  pendingAtBank: z.boolean(),
  transactionId: uuidSchema.nullable(),
});
export type Staged = z.infer<typeof stagedSchema>;
export const stagedPageSchema = z.object({
  items: z.array(stagedSchema),
  nextCursor: z.string().nullable(),
  pendingCount: z.number().int(),
});
export const listStagedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().min(1).max(512).optional(),
  status: z.enum(["pending", "accepted", "dismissed"]).optional(),
  batchId: uuidSchema.optional(),
  bankAccountId: uuidSchema.optional(),
  duplicates: z.enum(["true", "false"]).optional(),
});
export const stagedParams = z.object({
  budgetId: uuidSchema,
  stagedId: uuidSchema,
});
export const updateStagedBody = z
  .strictObject({
    name: z.string().trim().min(1).max(500).optional(),
    type: z.enum(["expense", "income"]).optional(),
    date: dateStringSchema.optional(),
    suggestedCategoryId: uuidSchema.nullable().optional(),
  })
  .refine(v => Object.keys(v).length > 0, {
    message: "Provide at least one field",
  });
export const acceptStagedBody = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: uuidSchema,
        categoryId: uuidSchema.nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});
export const acceptStagedResponse = z.object({
  accepted: z.number().int(),
  transactionIds: z.array(uuidSchema),
});
export const dismissStagedBody = z.strictObject({
  ids: z.array(uuidSchema).min(1).max(500),
});
export const dismissStagedResponse = z.object({ dismissed: z.number().int() });
export const stageCsvResponse = z.object({
  batchId: uuidSchema,
  staged: z.number().int(),
  duplicates: z.number().int(),
  skippedExact: z.number().int(),
  issues: z.array(importIssueSchema),
});
export const batchSchema = z.object({
  id: uuidSchema,
  source: z.enum(["csv", "plaid", "simplefin"]),
  label: z.string(),
  createdAt: z.string(),
  counts: z.object({
    pending: z.number().int(),
    accepted: z.number().int(),
    dismissed: z.number().int(),
  }),
});
export const batchListSchema = z.object({ items: z.array(batchSchema) });
export const batchParams = z.object({
  budgetId: uuidSchema,
  batchId: uuidSchema,
});

// ---------- M5: bank connections ----------

export const BANK_PROVIDERS = ["plaid", "simplefin"] as const;
export const bankProviderSchema = z.enum(BANK_PROVIDERS);

export const bankProvidersResponse = z.object({
  encryptionConfigured: z.boolean(),
  providers: z.array(
    z.object({ id: bankProviderSchema, configured: z.boolean() }),
  ),
});

export const bankAccountSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  mask: z.string().nullable(),
  type: z.string().nullable(),
  enabled: z.boolean(),
});
export const bankConnectionSchema = z.object({
  id: uuidSchema,
  provider: bankProviderSchema,
  institutionName: z.string().nullable(),
  status: z.enum(["active", "needs_reauth", "error", "disabled"]),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  accounts: z.array(bankAccountSchema),
});
export type BankConnection = z.infer<typeof bankConnectionSchema>;
export const bankConnectionListSchema = z.object({
  items: z.array(bankConnectionSchema),
});
export const connectionParams = z.object({
  budgetId: uuidSchema,
  connectionId: uuidSchema,
});
export const linkStartBody = z.strictObject({ provider: bankProviderSchema });
export const linkStartResponse = z.object({
  linkToken: z.string().optional(),
  instructions: z.string().optional(),
});
export const linkCompleteBody = z.strictObject({
  provider: bankProviderSchema,
  publicToken: z.string().min(1).max(500).optional(),
  setupToken: z.string().min(1).max(2000).optional(),
});
export const updateConnectionBody = z
  .strictObject({
    enabled: z.boolean().optional(),
    accounts: z
      .array(z.strictObject({ id: uuidSchema, enabled: z.boolean() }))
      .max(100)
      .optional(),
  })
  .refine(v => v.enabled !== undefined || v.accounts !== undefined, {
    message: "Provide enabled or accounts",
  });
export const syncQueuedResponse = z.object({ queued: z.literal(true) });
