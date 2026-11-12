# ADR-0003: Widget query DSL

- **Status:** Accepted
- **Date:** 2026-11-11
- **Milestone:** M6 (also used by M7)

## Context

Dashboards are built from widgets (M6). The AI agent can create widgets (M7), and ADR-0001 requires that generated widgets use the same spec as hand-built ones and that nothing a model produces is executed. So a widget needs a way to say "which data" that is safe to accept from an untrusted author: no raw SQL, no way to reach another budget, bounded cost.

## Decision

A widget's data request is a JSON object validated by a zod schema in `packages/contract`. It is a closed shape: every field is an enumeration, a bounded number, a date, or an ID that is checked against the budget. `packages/core` compiles it to a Drizzle query. There is no expression language and no string that reaches SQL.

### Shape (version 1)

```jsonc
{
  "version": 1,
  "source": "transactions",                  // the only source in v1
  "filters": {
    "type": "expense",                       // "expense" | "income" | omitted for both
    "categoryIds": ["<uuid>"],               // optional, max 50; null entry means uncategorised
    "excludeCategoryIds": ["<uuid>"],        // optional, max 50
    "dateRange": { "preset": "this_month" }, // or { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
    "amountCents": { "min": 0, "max": 50000 }, // optional
    "nameContains": "coffee"                 // optional, max 100 chars, matched with ILIKE, escaped
  },
  "groupBy": "category",                     // "none" | "category" | "type" | "day" | "week" | "month" | "year"
  "measure": "sum",                          // "sum" | "count" | "avg" | "rows"
  "sort": { "by": "value", "dir": "desc" },  // by: "value" | "key"
  "limit": 10,                               // 1 to 500, default 100
  "compare": "previous_period"               // optional: "previous_period" | "previous_year"
}
```

Date presets: `today`, `this_week`, `this_month`, `this_year`, `last_7_days`, `last_30_days`, `last_90_days`, `last_month`, `last_year`, `all_time`. A dashboard-level date range, when set, overrides a widget's `dateRange` unless the widget sets `"dateRangeLocked": true`.

With `groupBy: "none"`, the measures `sum`, `count` and `avg` return a single value (for stat widgets). The measure `rows` is only valid with `groupBy: "none"` and returns the matching transactions themselves (id, date, name, type, category, amountCents) for table widgets, with `sort.by` being `"date"` or `"amount"` and the same `limit`.

### Result

```jsonc
{
  "series": [ { "key": "<group key>", "label": "Groceries", "value": 43210 } ],
  "compare": [ { "key": "<group key>", "label": "Groceries", "value": 39800 } ], // when requested
  "unit": "cents",        // "cents" for sum and avg, "count" for count
  "range": { "from": "2026-11-01", "to": "2026-11-30" }
}
```

### Safety rules

1. **The budget is not part of the DSL.** It comes from the route (`/api/v1/budgets/{budgetId}/widgets/query`) after the membership check and is injected by the compiler. A spec cannot name a budget.
2. Category IDs in a spec are resolved inside the budget. IDs from another budget match nothing; they do not error in a way that reveals existence.
3. Unknown fields are rejected (`.strict()`), so a newer or a hallucinated field fails validation instead of being ignored.
4. `limit` is capped, time buckets are capped at 1,000, and each query runs with a statement timeout.
5. The compiler builds queries with Drizzle's query builder only. A lint rule or test asserts the module contains no raw `sql` string interpolation of spec values.
6. The viewer role can run queries. Running a query never writes.

### Evolution

The spec carries `version`. New sources (for example `staged_transactions`, or budget targets for budget-versus-actual) and new group keys are added to the enumerations. A breaking change bumps the version, and the compiler keeps supporting older versions stored in saved dashboards.

## Alternatives considered

- **Raw SQL with a read-only role and row-level security.** Most flexible, but reintroduces database-level authorization that ADR-0001 moved into application code, and a model writing SQL is hard to bound.
- **A general expression language (filters as trees with AND/OR/NOT, computed fields).** More expressive than needed now, and harder for a model to produce correctly and for a human to edit in a form. The closed shape can grow into this if needed.
- **A fixed list of named reports with parameters.** Safest, but "build me a widget for X" would rarely fit; every new idea would need code.
- **GraphQL.** A second API style to secure and document.

## Consequences

- The grid editor can render a form for a widget because every field is enumerable.
- A model can be given the zod schema as a tool input schema and will produce valid specs or get a precise validation error.
- Questions the DSL cannot express need a DSL change. That is intended: each extension is reviewed once.
- Budget-versus-actual needs budget targets, which do not exist yet. M6 adds them as a second source.
