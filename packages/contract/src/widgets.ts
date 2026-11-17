/**
 * Widget query DSL (ADR-0003, extended by ADR-0010), widget specs, dashboard documents and
 * their API shapes. Every object is strict: an unknown or hallucinated field is a validation
 * error, never silently ignored. The budget is never part of a query.
 */
import { z } from "zod";
import {
  amountCentsSchema,
  budgetIdParams,
  dateStringSchema,
  transactionTypeSchema,
  uuidSchema,
} from "./common";

// ---------- dates ----------

export const DATE_PRESETS = [
  "today",
  "this_week",
  "this_month",
  "this_year",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "last_month",
  "last_year",
  "all_time",
] as const;
export const datePresetSchema = z.enum(DATE_PRESETS);
export type DatePreset = z.infer<typeof datePresetSchema>;

export const dateRangeSchema = z.union([
  z.strictObject({ preset: datePresetSchema }),
  z
    .strictObject({ from: dateStringSchema, to: dateStringSchema })
    .refine(r => r.from <= r.to, { message: "from must not be after to" }),
]);
export type DateRange = z.infer<typeof dateRangeSchema>;

// ---------- queries ----------

export const GROUP_BYS = [
  "none",
  "category",
  "type",
  "day",
  "week",
  "month",
  "year",
] as const;
export const MEASURES = ["sum", "count", "avg", "rows", "net"] as const;
export const TIME_GROUPS = ["day", "week", "month", "year"] as const;

const filtersSchema = z.strictObject({
  type: transactionTypeSchema.optional(),
  /** A `null` entry means "uncategorised". */
  categoryIds: z.array(uuidSchema.nullable()).max(50).optional(),
  excludeCategoryIds: z.array(uuidSchema).max(50).optional(),
  dateRange: dateRangeSchema.optional(),
  amountCents: z
    .strictObject({
      min: amountCentsSchema.optional(),
      max: amountCentsSchema.optional(),
    })
    .optional(),
  nameContains: z.string().min(1).max(100).optional(),
});

export const transactionsQuerySchema = z
  .strictObject({
    version: z.literal(1).default(1),
    source: z.literal("transactions"),
    filters: filtersSchema.default({}),
    groupBy: z.enum(GROUP_BYS),
    measure: z.enum(MEASURES),
    sort: z
      .strictObject({
        by: z.enum(["value", "key", "date", "amount"]),
        dir: z.enum(["asc", "desc"]),
      })
      .optional(),
    /** Defaults to 100 for category, type and rows; time series are capped by the bucket limit instead. */
    limit: z.number().int().min(1).max(500).optional(),
    compare: z.enum(["previous_period", "previous_year"]).optional(),
    /** Keep this query's own range when the dashboard range changes. */
    dateRangeLocked: z.boolean().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.measure === "rows" && q.groupBy !== "none")
      ctx.addIssue({
        code: "custom",
        path: ["groupBy"],
        message: 'measure "rows" requires groupBy "none"',
      });
    if (q.sort) {
      const allowed =
        q.measure === "rows" ? ["date", "amount"] : ["value", "key"];
      if (!allowed.includes(q.sort.by))
        ctx.addIssue({
          code: "custom",
          path: ["sort", "by"],
          message: `sort.by must be ${allowed.join(" or ")} for measure "${q.measure}"`,
        });
    }
    if (q.measure === "rows" && q.compare)
      ctx.addIssue({
        code: "custom",
        path: ["compare"],
        message: 'compare is not available for measure "rows"',
      });
  });
export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;

export const targetsQuerySchema = z.strictObject({
  version: z.literal(1).default(1),
  source: z.literal("category_targets"),
  filters: z
    .strictObject({
      categoryIds: z.array(uuidSchema).max(50).optional(),
      dateRange: dateRangeSchema.optional(),
    })
    .default({}),
  dateRangeLocked: z.boolean().optional(),
});
export type TargetsQuery = z.infer<typeof targetsQuerySchema>;

export const widgetQuerySchema = z.discriminatedUnion("source", [
  transactionsQuerySchema,
  targetsQuerySchema,
]);
export type WidgetQuery = z.infer<typeof widgetQuerySchema>;

// ---------- results ----------

export const resultRangeSchema = z.object({
  from: dateStringSchema,
  to: dateStringSchema,
});
export const seriesPointSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  /** budget-vs-actual only */
  target: z.number().optional(),
  remaining: z.number().optional(),
});
export const resultRowSchema = z.object({
  id: uuidSchema,
  date: dateStringSchema,
  name: z.string(),
  type: transactionTypeSchema,
  categoryId: uuidSchema.nullable(),
  category: z.string().nullable(),
  amountCents: z.number().int(),
});
export const queryResultSchema = z.object({
  series: z.array(seriesPointSchema),
  compare: z.array(seriesPointSchema).optional(),
  rows: z.array(resultRowSchema).optional(),
  unit: z.enum(["cents", "count"]),
  range: resultRangeSchema,
  compareRange: resultRangeSchema.optional(),
});
export type QueryResult = z.infer<typeof queryResultSchema>;

export const queryErrorSchema = z.object({
  error: z.object({ message: z.string(), details: z.unknown().optional() }),
});
export const querySlotSchema = z.union([queryResultSchema, queryErrorSchema]);
export type QuerySlot = z.infer<typeof querySlotSchema>;

export const MAX_BATCH_QUERIES = 40;
export const queryBatchBody = z.strictObject({
  queries: z.array(widgetQuerySchema).min(1).max(MAX_BATCH_QUERIES),
  /** Replaces each query's own range unless the query sets `dateRangeLocked`. */
  dateRange: dateRangeSchema.optional(),
  /** The caller's local calendar date, for presets such as "this_month". Defaults to the server's UTC date. */
  today: dateStringSchema.optional(),
});
export type QueryBatchBody = z.infer<typeof queryBatchBody>;
export const queryBatchResponse = z.object({
  results: z.array(querySlotSchema),
});

// ---------- widget specs ----------

export const displaySchema = z.strictObject({
  format: z.enum(["currency", "number", "percent"]).optional(),
  showCompare: z.boolean().optional(),
  showPerDay: z.boolean().optional(),
  stacked: z.boolean().optional(),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
  showLegend: z.boolean().optional(),
  maxItems: z.number().int().min(1).max(50).optional(),
});
export type Display = z.infer<typeof displaySchema>;

export const WIDGET_TYPES = [
  "stat",
  "pie",
  "bar",
  "line",
  "table",
  "budget-vs-actual",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

type Checker = (
  q: WidgetQuery,
  issue: (path: string[], message: string) => void,
) => void;

const needsTransactions: Checker = (q, issue) => {
  if (q.source !== "transactions")
    issue(["query", "source"], 'must be "transactions"');
};
const CHECKS: Record<WidgetType, Checker> = {
  stat: (q, issue) => {
    needsTransactions(q, issue);
    if (q.source !== "transactions") return;
    if (q.groupBy !== "none")
      issue(["query", "groupBy"], 'a stat needs groupBy "none"');
    if (!["sum", "count", "avg", "net"].includes(q.measure))
      issue(
        ["query", "measure"],
        "a stat needs measure sum, count, avg or net",
      );
  },
  pie: (q, issue) => {
    needsTransactions(q, issue);
    if (q.source !== "transactions") return;
    if (!["category", "type"].includes(q.groupBy))
      issue(["query", "groupBy"], "a pie needs groupBy category or type");
    if (!["sum", "count"].includes(q.measure))
      issue(["query", "measure"], "a pie needs measure sum or count");
  },
  bar: (q, issue) => {
    needsTransactions(q, issue);
    if (q.source !== "transactions") return;
    if (q.groupBy === "none")
      issue(["query", "groupBy"], "a bar chart needs a groupBy");
    if (q.measure === "rows")
      issue(["query", "measure"], 'a bar chart cannot use measure "rows"');
  },
  line: (q, issue) => {
    needsTransactions(q, issue);
    if (q.source !== "transactions") return;
    if (!(TIME_GROUPS as readonly string[]).includes(q.groupBy))
      issue(
        ["query", "groupBy"],
        "a line needs groupBy day, week, month or year",
      );
    if (q.measure === "rows")
      issue(["query", "measure"], 'a line cannot use measure "rows"');
  },
  table: (q, issue) => needsTransactions(q, issue),
  "budget-vs-actual": (q, issue) => {
    if (q.source !== "category_targets")
      issue(["query", "source"], 'must be "category_targets"');
  },
};

function widget<T extends WidgetType>(type: T) {
  return z
    .strictObject({
      version: z.literal(1).default(1),
      type: z.literal(type),
      title: z.string().trim().min(1).max(80),
      query: widgetQuerySchema,
      display: displaySchema.default({}),
    })
    .superRefine((spec, ctx) =>
      CHECKS[type](spec.query, (path, message) =>
        ctx.addIssue({ code: "custom", path, message }),
      ),
    );
}

export const widgetSpecSchema = z.discriminatedUnion("type", [
  widget("stat"),
  widget("pie"),
  widget("bar"),
  widget("line"),
  widget("table"),
  widget("budget-vs-actual"),
]);
export type WidgetSpec = z.infer<typeof widgetSpecSchema>;
export type WidgetSpecInput = z.input<typeof widgetSpecSchema>;

// ---------- dashboards ----------

export const MAX_WIDGETS = 40;
export const MAX_DASHBOARDS = 20;

export const layoutSchema = z.strictObject({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(40),
});

export const dashboardDocSchema = z.strictObject({
  version: z.literal(1).default(1),
  dateRange: dateRangeSchema.default({ preset: "this_month" }),
  widgets: z
    .array(
      z.strictObject({
        id: uuidSchema,
        layout: layoutSchema,
        spec: widgetSpecSchema,
      }),
    )
    .max(MAX_WIDGETS),
});
export type DashboardDoc = z.infer<typeof dashboardDocSchema>;
export type DashboardDocInput = z.input<typeof dashboardDocSchema>;

export const dashboardSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isDefault: z.boolean(),
  doc: dashboardDocSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export const dashboardListSchema = z.object({
  items: z.array(dashboardSchema),
});

export const dashboardParams = budgetIdParams.extend({
  dashboardId: uuidSchema,
});
export const dashboardName = z.string().trim().min(1).max(100);

export const TEMPLATE_IDS = [
  "classic",
  "monthly-trends",
  "budget-check",
] as const;
export const templateIdSchema = z.enum(TEMPLATE_IDS);

export const createDashboardBody = z
  .strictObject({
    name: dashboardName,
    doc: dashboardDocSchema.optional(),
    templateId: templateIdSchema.optional(),
  })
  .refine(b => !(b.doc && b.templateId), {
    message: "Provide doc or templateId, not both",
  });
export type CreateDashboardBody = z.infer<typeof createDashboardBody>;

export const replaceDashboardBody = z.strictObject({
  name: dashboardName,
  doc: dashboardDocSchema,
  isDefault: z.boolean(),
  /** The `updatedAt` you last read. A copy older than the stored one is refused with 409. */
  updatedAt: z.string().max(64),
});
export type ReplaceDashboardBody = z.infer<typeof replaceDashboardBody>;

export const dashboardTemplateSchema = z.object({
  id: templateIdSchema,
  name: z.string(),
  description: z.string(),
  doc: dashboardDocSchema,
});
export type DashboardTemplate = z.infer<typeof dashboardTemplateSchema>;
export const dashboardTemplateListSchema = z.object({
  items: z.array(dashboardTemplateSchema),
});

export const widgetTypeInfoSchema = z.object({
  type: z.enum(WIDGET_TYPES),
  label: z.string(),
  schema: z.unknown(),
  defaultSpec: z.unknown(),
});
export const widgetTypeListSchema = z.object({
  items: z.array(widgetTypeInfoSchema),
});

export const validateWidgetBody = z.strictObject({ spec: z.unknown() });
export const validateWidgetResponse = z.object({
  valid: z.boolean(),
  issues: z.array(
    z.object({
      path: z.array(z.union([z.string(), z.number()])),
      message: z.string(),
    }),
  ),
});

// ---------- category targets ----------

export const targetSchema = z.object({
  categoryId: uuidSchema,
  amountCents: z.number().int().min(0),
  updatedAt: z.string(),
});
export type Target = z.infer<typeof targetSchema>;
export const targetListSchema = z.object({ items: z.array(targetSchema) });
export const targetParams = budgetIdParams.extend({ categoryId: uuidSchema });
export const setTargetBody = z.strictObject({
  amountCents: z.number().int().min(0).max(2_147_483_647),
});

// ---------- default specs (one per type; the UI registry and GET /widget-types use these) ----------

const thisMonth = { preset: "this_month" } as const;
const tx = (
  groupBy: (typeof GROUP_BYS)[number],
  measure: (typeof MEASURES)[number],
  filters: z.input<typeof filtersSchema> = {},
): z.input<typeof transactionsQuerySchema> => ({
  version: 1,
  source: "transactions",
  filters: { dateRange: thisMonth, ...filters },
  groupBy,
  measure,
});

export const defaultSpecs: Record<WidgetType, WidgetSpecInput> = {
  stat: {
    version: 1,
    type: "stat",
    title: "Expenses",
    query: tx("none", "sum", { type: "expense" }),
    display: { format: "currency", showCompare: true },
  },
  pie: {
    version: 1,
    type: "pie",
    title: "Spending by category",
    query: tx("category", "sum", { type: "expense" }),
    display: { showLegend: true, maxItems: 8 },
  },
  bar: {
    version: 1,
    type: "bar",
    title: "Spending by category",
    query: {
      ...tx("category", "sum", { type: "expense" }),
      sort: { by: "value", dir: "desc" },
      limit: 10,
    },
    display: { orientation: "vertical" },
  },
  line: {
    version: 1,
    type: "line",
    title: "Spending over time",
    query: tx("day", "sum", { type: "expense" }),
    display: {},
  },
  table: {
    version: 1,
    type: "table",
    title: "Recent expenses",
    query: {
      ...tx("none", "rows", { type: "expense" }),
      sort: { by: "date", dir: "desc" },
      limit: 10,
    },
    display: {},
  },
  "budget-vs-actual": {
    version: 1,
    type: "budget-vs-actual",
    title: "Budget vs actual",
    query: {
      version: 1,
      source: "category_targets",
      filters: { dateRange: thisMonth },
    },
    display: {},
  },
};

export const WIDGET_LABELS: Record<WidgetType, string> = {
  stat: "Stat",
  pie: "Pie chart",
  bar: "Bar chart",
  line: "Line chart",
  table: "Table",
  "budget-vs-actual": "Budget vs actual",
};
