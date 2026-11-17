import { z } from "zod";
import {
  amountCentsSchema,
  budgetIdParams,
  dateStringSchema,
  pageSchema,
  paginationQuerySchema,
  transactionTypeSchema,
  uuidSchema,
} from "./common";

// ---------- proposal operations (M7) ----------

export const MAX_PROPOSAL_OPERATIONS = 100;

/** A category created earlier in the same proposal, by operation index. */
export const categoryRefSchema = z.strictObject({
  $ref: z
    .number()
    .int()
    .min(0)
    .max(MAX_PROPOSAL_OPERATIONS - 1),
});
export type CategoryRef = z.infer<typeof categoryRefSchema>;
const categoryIdOrRef = z.union([uuidSchema, categoryRefSchema]);

const nameSchema = z.string().trim().min(1).max(500);
const notesSchema = z.string().max(5000);
const categoryName = z.string().trim().min(2).max(60);

export const proposalOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("transaction.create"),
    data: z.strictObject({
      type: transactionTypeSchema,
      name: nameSchema,
      amountCents: amountCentsSchema,
      date: dateStringSchema,
      categoryId: categoryIdOrRef.nullish(),
      notes: notesSchema.nullish(),
    }),
  }),
  z.strictObject({
    op: z.literal("transaction.update"),
    id: uuidSchema,
    data: z
      .strictObject({
        type: transactionTypeSchema.optional(),
        name: nameSchema.optional(),
        amountCents: amountCentsSchema.optional(),
        date: dateStringSchema.optional(),
        categoryId: categoryIdOrRef.nullable().optional(),
        notes: notesSchema.nullable().optional(),
      })
      .refine(v => Object.keys(v).length > 0, {
        message: "Provide at least one field",
      }),
  }),
  z.strictObject({ op: z.literal("transaction.delete"), id: uuidSchema }),
  z.strictObject({
    op: z.literal("category.create"),
    data: z.strictObject({ name: categoryName }),
  }),
  z.strictObject({
    op: z.literal("category.update"),
    id: uuidSchema,
    data: z
      .strictObject({
        name: categoryName.optional(),
        isActive: z.boolean().optional(),
      })
      .refine(v => v.name !== undefined || v.isActive !== undefined, {
        message: "Provide name or isActive",
      }),
  }),
  z.strictObject({
    op: z.literal("staged.accept"),
    items: z
      .array(
        z.strictObject({
          id: uuidSchema,
          categoryId: categoryIdOrRef.nullish(),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.strictObject({
    op: z.literal("staged.dismiss"),
    ids: z.array(uuidSchema).min(1).max(100),
  }),
  z.strictObject({
    op: z.literal("category_target.set"),
    categoryId: categoryIdOrRef,
    amountCents: z.number().int().min(0).max(2_147_483_647),
  }),
]);
export type ProposalOperation = z.infer<typeof proposalOperationSchema>;

export const proposalOperationsSchema = z
  .array(proposalOperationSchema)
  .min(1)
  .max(MAX_PROPOSAL_OPERATIONS);

export const proposalSummarySchema = z.string().trim().min(1).max(300);

export const createProposalBody = z.strictObject({
  summary: proposalSummarySchema,
  operations: proposalOperationsSchema,
});
export type CreateProposalBody = z.infer<typeof createProposalBody>;

const previewRecord = z.record(z.string(), z.unknown());
export const previewItemSchema = z.object({
  index: z.number().int(),
  op: z.string(),
  kind: z.enum(["create", "update", "delete"]),
  /** Server-written label, for example the transaction name. */
  label: z.string(),
  before: previewRecord.nullable(),
  after: previewRecord.nullable(),
});
export const proposalPreviewSchema = z.object({
  items: z.array(previewItemSchema),
  totals: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    deleted: z.number().int(),
    expenseDeltaCents: z.number().int(),
    incomeDeltaCents: z.number().int(),
  }),
});
export type ProposalPreview = z.infer<typeof proposalPreviewSchema>;

export const PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "failed",
] as const;

export const proposalSchema = z.object({
  id: uuidSchema,
  budgetId: uuidSchema,
  userId: z.string(),
  conversationId: uuidSchema.nullable(),
  origin: z.enum(["chat", "mcp"]),
  summary: z.string(),
  operations: z.array(proposalOperationSchema),
  preview: proposalPreviewSchema,
  status: z.enum(PROPOSAL_STATUSES),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  result: z.unknown().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export const proposalPageSchema = pageSchema(proposalSchema);
export const listProposalsQuery = paginationQuerySchema.extend({
  status: z.enum(PROPOSAL_STATUSES).optional(),
});
export const proposalParams = budgetIdParams.extend({ proposalId: uuidSchema });
export const approveProposalBody = z.strictObject({
  /** Indexes of the operations to apply; omitted means all. */
  operationIndexes: z
    .array(z.number().int().min(0))
    .min(1)
    .max(MAX_PROPOSAL_OPERATIONS)
    .optional(),
});

// ---------- conversations ----------

export const aiStatusSchema = z.object({
  configured: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
});

export const conversationSchema = z.object({
  id: uuidSchema,
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const conversationListSchema = z.object({
  items: z.array(conversationSchema),
});
export const conversationParams = budgetIdParams.extend({
  conversationId: uuidSchema,
});
export const messageSchema = z.object({
  id: uuidSchema,
  role: z.enum(["user", "assistant", "tool"]),
  content: z.unknown(),
  createdAt: z.string(),
});
export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(messageSchema),
});
export const sendMessageBody = z.strictObject({
  content: z.string().trim().min(1).max(4000),
});

/** What the message endpoint streams, one JSON object per server-sent event. */
export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    id: z.string(),
    tool: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string(),
    tool: z.string(),
    /** A short human line, for example "Looked at 143 transactions". */
    summary: z.string(),
    ok: z.boolean(),
  }),
  z.object({ type: z.literal("proposal"), proposal: proposalSchema }),
  z.object({
    type: z.literal("widget"),
    spec: z.unknown(),
    preview: z.unknown(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

// ---------- audit ----------

export const auditEntrySchema = z.object({
  id: uuidSchema,
  userId: z.string(),
  origin: z.enum(["chat", "mcp"]),
  conversationId: uuidSchema.nullable(),
  event: z.enum([
    "tool_call",
    "proposal_created",
    "proposal_approved",
    "proposal_rejected",
    "proposal_failed",
    "proposal_expired",
  ]),
  tool: z.string().nullable(),
  input: z.unknown().nullable(),
  outcome: z.string(),
  detail: z.unknown().nullable(),
  createdAt: z.string(),
});
export const auditPageSchema = pageSchema(auditEntrySchema);

// ---------- personal access tokens ----------

export const TOKEN_PREFIX = "kash_";
export const tokenSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  prefix: z.string(),
  scope: z.enum(["read", "read_propose"]),
  budgetIds: z.array(uuidSchema).nullable(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export const tokenListSchema = z.object({ items: z.array(tokenSchema) });
export const createTokenBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(["read", "read_propose"]),
  budgetIds: z.array(uuidSchema).min(1).max(50).optional(),
  /** Omitted: 90 days. Explicit `null`: never expires. Otherwise at most one year ahead. */
  expiresAt: z.iso.datetime().nullable().optional(),
});
export const tokenCreatedSchema = tokenSchema.extend({
  /** Shown once. */
  token: z.string(),
});
export const tokenParams = z.object({ tokenId: uuidSchema });
