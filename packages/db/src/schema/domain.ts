import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const budgetRole = pgEnum("budget_role", ["owner", "editor", "viewer"]);
export const transactionType = pgEnum("transaction_type", [
  "expense",
  "income",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("USD"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  t => [
    check("budgets_name_length", sql`char_length(${t.name}) between 2 and 200`),
  ],
);

export const budgetMembers = pgTable(
  "budget_members",
  {
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: budgetRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    primaryKey({ columns: [t.budgetId, t.userId] }),
    index("budget_members_user_id_idx").on(t.userId),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  t => [
    // Target of composite foreign keys: a reference can never cross budgets (M9, ADR-0014).
    unique("categories_budget_id_id_uq").on(t.budgetId, t.id),
    uniqueIndex("categories_budget_id_lower_name_uq").on(
      t.budgetId,
      sql`lower(${t.name})`,
    ),
    check(
      "categories_name_length",
      sql`char_length(${t.name}) between 2 and 200`,
    ),
  ],
);

// ADR-0002: one table, positive integer cents, calendar dates.
export const txSource = pgEnum("transaction_source", [
  "manual",
  "csv",
  "plaid",
  "simplefin",
]);
export const importSource = pgEnum("import_source", [
  "csv",
  "plaid",
  "simplefin",
]);
export const bankProvider = pgEnum("bank_provider", ["plaid", "simplefin"]);
export const connectionStatus = pgEnum("bank_connection_status", [
  "active",
  "needs_reauth",
  "error",
  "disabled",
]);
export const stagedStatus = pgEnum("staged_status", [
  "pending",
  "accepted",
  "dismissed",
]);
export const duplicateConfidence = pgEnum("duplicate_confidence", [
  "exact",
  "likely",
]);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    type: transactionType("type").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    // M5: where the row came from.
    source: txSource("source").notNull().default("manual"),
    externalId: text("external_id"),
    bankAccountId: uuid("bank_account_id").references(
      (): AnyPgColumn => bankAccounts.id,
      { onDelete: "set null" },
    ),
    ...timestamps,
  },
  t => [
    unique("transactions_budget_id_id_uq").on(t.budgetId, t.id),
    uniqueIndex("transactions_external_uq")
      .on(t.budgetId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    check("transactions_amount_positive", sql`${t.amountCents} > 0`),
    check(
      "transactions_name_length",
      sql`char_length(${t.name}) between 1 and 500`,
    ),
    index("transactions_budget_date_idx").on(t.budgetId, t.date.desc()),
    index("transactions_budget_type_date_idx").on(
      t.budgetId,
      t.type,
      t.date.desc(),
    ),
    index("transactions_budget_category_idx").on(t.budgetId, t.categoryId),
  ],
);

// Created now so M5 needs no restructuring; nothing reads or writes it in M1.
export const importPresets = pgTable("import_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetId: uuid("budget_id")
    .notNull()
    .references(() => budgets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mapping: jsonb("mapping").notNull(),
  ...timestamps,
});

export const inviteRole = pgEnum("invite_role", ["editor", "viewer"]);

// M4: single-use invite links. Only the SHA-256 of the token is stored.
export const budgetInvites = pgTable(
  "budget_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: inviteRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    uniqueIndex("budget_invites_pending_uq")
      .on(t.budgetId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index("budget_invites_budget_idx").on(t.budgetId),
  ],
);

// M6: personal dashboards (one document per dashboard) and monthly category targets.
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    doc: jsonb("doc").notNull(),
    ...timestamps,
  },
  t => [
    check(
      "dashboards_name_length",
      sql`char_length(${t.name}) between 1 and 100`,
    ),
    uniqueIndex("dashboards_one_default_uq")
      .on(t.budgetId, t.userId)
      .where(sql`${t.isDefault}`),
    index("dashboards_budget_user_idx").on(t.budgetId, t.userId),
  ],
);

export const targetPeriod = pgEnum("target_period", ["month"]);

export const categoryTargets = pgTable(
  "category_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    period: targetPeriod("period").notNull().default("month"),
    amountCents: integer("amount_cents").notNull(),
    ...timestamps,
  },
  t => [
    check("category_targets_amount", sql`${t.amountCents} >= 0`),
    uniqueIndex("category_targets_uq").on(t.budgetId, t.categoryId, t.period),
  ],
);

// ---------- M7: AI agent ----------

export const aiMessageRole = pgEnum("ai_message_role", [
  "user",
  "assistant",
  "tool",
]);
export const agentOrigin = pgEnum("agent_origin", ["chat", "mcp"]);
export const proposalStatus = pgEnum("proposal_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
  "failed",
]);
export const auditEvent = pgEnum("agent_audit_event", [
  "tool_call",
  "proposal_created",
  "proposal_approved",
  "proposal_rejected",
  "proposal_failed",
  "proposal_expired",
]);
export const tokenScope = pgEnum("api_token_scope", ["read", "read_propose"]);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    ...timestamps,
  },
  t => [
    unique("ai_conversations_budget_id_id_uq").on(t.budgetId, t.id),
    index("ai_conversations_owner_idx").on(
      t.budgetId,
      t.userId,
      t.updatedAt.desc(),
    ),
  ],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: aiMessageRole("role").notNull(),
    /** Text parts, tool calls and tool results. */
    content: jsonb("content").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt),
  ],
);

export const agentProposals = pgTable(
  "agent_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    /** Who the agent was acting for. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(
      () => aiConversations.id,
      { onDelete: "set null" },
    ),
    origin: agentOrigin("origin").notNull(),
    /** Written by the model; shown as untrusted plain text. */
    summary: text("summary").notNull(),
    operations: jsonb("operations").notNull(),
    /** Computed by the server when the proposal is created. */
    preview: jsonb("preview").notNull(),
    status: proposalStatus("status").notNull().default("pending"),
    decidedBy: text("decided_by").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    result: jsonb("result"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    index("agent_proposals_budget_idx").on(
      t.budgetId,
      t.status,
      t.createdAt.desc(),
    ),
  ],
);

/** Append-only: nothing in the codebase updates or deletes these rows. */
export const agentAuditLog = pgTable(
  "agent_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    origin: agentOrigin("origin").notNull(),
    conversationId: uuid("conversation_id"),
    event: auditEvent("event").notNull(),
    tool: text("tool"),
    input: jsonb("input"),
    /** 'ok' | 'denied' | 'error' */
    outcome: text("outcome").notNull(),
    /** Row counts, proposal id, error code. Never full result data. */
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [index("agent_audit_budget_idx").on(t.budgetId, t.createdAt.desc())],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 of the token. The token itself is shown once and never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    /** First characters, for display. */
    prefix: text("prefix").notNull(),
    scope: tokenScope("scope").notNull(),
    /** Null means every budget the user belongs to. */
    budgetIds: uuid("budget_ids").array(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    index("api_tokens_user_idx").on(t.userId),
    check(
      "api_tokens_expiry_after_creation",
      sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.createdAt}`,
    ),
    // One live token per name and user (M9 scope 11).
    uniqueIndex("api_tokens_user_name_live_uq")
      .on(t.userId, t.name)
      .where(sql`${t.revokedAt} is null`),
  ],
);

// ---------- M5: import and bank sync ----------

export const bankConnections = pgTable(
  "bank_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    provider: bankProvider("provider").notNull(),
    institutionName: text("institution_name"),
    externalId: text("external_id"),
    /** ADR-0005 format. The Plaid access token or the SimpleFIN access URL. */
    secretEncrypted: text("secret_encrypted").notNull(),
    syncCursor: text("sync_cursor"),
    status: connectionStatus("status").notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Sanitised message, never a token. */
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  t => [index("bank_connections_budget_idx").on(t.budgetId)],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => bankConnections.id, { onDelete: "cascade" }),
    /** Denormalised for scoping. */
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    /** Last four digits only. */
    mask: text("mask"),
    type: text("type"),
    enabled: boolean("enabled").notNull().default(true),
  },
  t => [
    unique("bank_accounts_budget_id_id_uq").on(t.budgetId, t.id),
    uniqueIndex("bank_accounts_conn_ext_uq").on(t.connectionId, t.externalId),
  ],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    source: importSource("source").notNull(),
    /** File name or institution. */
    label: text("label").notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [unique("import_batches_budget_id_id_uq").on(t.budgetId, t.id)],
);

export const stagedTransactions = pgTable(
  "staged_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    source: importSource("source").notNull(),
    externalId: text("external_id"),
    type: transactionType("type").notNull(),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    suggestedCategoryId: uuid("suggested_category_id").references(
      () => categories.id,
      { onDelete: "set null" },
    ),
    status: stagedStatus("status").notNull().default("pending"),
    duplicateOf: uuid("duplicate_of").references(() => transactions.id, {
      onDelete: "set null",
    }),
    duplicateConfidence: duplicateConfidence("duplicate_confidence"),
    pendingAtBank: boolean("pending_at_bank").notNull().default(false),
    /** Provider payload with account numbers removed. */
    raw: jsonb("raw"),
    /** Set when accepted. */
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  t => [
    check("staged_amount_positive", sql`${t.amountCents} > 0`),
    uniqueIndex("staged_external_uq")
      .on(t.budgetId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("staged_budget_status_idx").on(t.budgetId, t.status, t.date.desc()),
  ],
);

// ---------- M9: security hardening ----------

/** Per-account sign-in failure counter. `key` is a hash of the normalised email, never the address. */
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
