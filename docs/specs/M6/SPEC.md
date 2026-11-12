# M6: Widgets and dashboards

- **Status:** Not started. Complete, but expect revision once earlier milestones have landed.
- **Depends on:** M1 (M4 for mobile layout)
- **ADRs:** [0001](../../adr/0001-foundational-decisions.md), [0003](../../adr/0003-widget-query-dsl.md)

## Goal

The fixed dashboard becomes one the user arranges. A dashboard is a grid of widgets; each widget is a declarative spec (what data, how to show it). Users add, configure, move and resize widgets, keep several dashboards per budget, and start from templates. The same spec is what the AI agent will generate in M7, so by the end of this milestone a widget can be created from JSON alone.

## Scope

1. Widget spec schema in `packages/contract`: type, query (ADR-0003), display options.
2. Query compiler and executor in `packages/core`.
3. Widget registry and renderers in `packages/ui`: `stat`, `pie`, `bar`, `line`, `table`, `budget-vs-actual`.
4. Category targets, the data that budget-versus-actual needs.
5. Dashboards: per-user, per-budget saved layouts with react-grid-layout; create, rename, duplicate, delete, set default.
6. Grid editor with a widget configuration form generated from the spec schema.
7. Templates, including one that reproduces the M1 dashboard.
8. A dashboard-level date range that widgets follow.

## Non-scope

- AI generation of widgets (M7). M6 only guarantees that a spec posted as JSON works.
- User-written code, formulas or custom SQL in widgets.
- Sharing one dashboard between members. Each user has their own; "duplicate from a template" covers reuse. Revisit after M7.
- Exporting dashboards as images or PDFs.
- Real-time updates. Widgets refresh on load, on range change and on demand.

## Data model changes

```
dashboards
  id          uuid pk
  budget_id   uuid not null references budgets(id) on delete cascade
  user_id     text not null references user(id) on delete cascade
  name        text not null                         -- 1 to 100 chars
  is_default  boolean not null default false
  doc         jsonb not null                        -- DashboardDoc, validated by zod on every write
  created_at, updated_at timestamptz
  unique (budget_id, user_id) where is_default
  index (budget_id, user_id)

category_targets
  id            uuid pk
  budget_id     uuid not null references budgets(id) on delete cascade
  category_id   uuid not null references categories(id) on delete cascade
  period        enum('month') not null default 'month'
  amount_cents  integer not null check (amount_cents >= 0)
  created_at, updated_at timestamptz
  unique (budget_id, category_id, period)
```

### DashboardDoc

```jsonc
{
  "version": 1,
  "dateRange": { "preset": "this_month" },          // dashboard-level range
  "widgets": [
    {
      "id": "<uuid>",
      "layout": { "x": 0, "y": 0, "w": 3, "h": 2 },  // 12-column grid; mobile stacks by y then x
      "spec": { /* WidgetSpec */ }
    }
  ]
}
```

At most 40 widgets per dashboard and 20 dashboards per user per budget.

### WidgetSpec

```jsonc
{
  "version": 1,
  "type": "bar",                       // "stat" | "pie" | "bar" | "line" | "table" | "budget-vs-actual"
  "title": "Spending by category",     // 1 to 80 chars, plain text
  "query": { /* ADR-0003 query */ },
  "display": {                         // per type; all optional, all enumerated or bounded
    "format": "currency",              // "currency" | "number" | "percent"
    "showCompare": true,
    "stacked": false,
    "orientation": "vertical",
    "showLegend": true,
    "maxItems": 8                      // remaining groups are merged into "Other"
  }
}
```

The schema is `.strict()` and is a discriminated union on `type`. Each type restricts which query shapes it accepts:

| Type | Query constraint | Notes |
|---|---|---|
| `stat` | `groupBy: "none"`, measure `sum`, `count` or `avg` | Optional `compare` shows the change against the previous period |
| `pie` | `groupBy` `category` or `type`, measure `sum` or `count` | |
| `bar` | any `groupBy` except `none` | |
| `line` | `groupBy` `day`, `week`, `month` or `year` | Missing buckets are filled with zero |
| `table` | measure `rows`, or any grouped query | |
| `budget-vs-actual` | source `category_targets`; filters limited to `categoryIds` and `dateRange` | Per category: target for the range, actual expense, remaining. Monthly targets are pro-rated by the inclusive day count when the range is not whole months. |

Titles and labels are rendered as text, never as HTML.

## Design

- **Registry.** `packages/ui/widgets/registry.ts` maps each type to `{ specSchema, defaultSpec, Renderer, ConfigForm, minSize, defaultSize }`. Adding a widget type is one entry plus its components. The query endpoint knows nothing about types.
- **Execution.** The client sends a query (not a widget) to the query endpoint and gets `{ series, compare?, unit, range }` back. Renderers are pure functions of spec and result. A widget whose spec fails validation or whose query errors shows an inline error card with the validation message and does not affect its neighbours.
- **Dashboard range.** The dashboard's `dateRange` replaces each widget's range at request time unless the widget sets `dateRangeLocked`.
- **Batching.** The dashboard page requests all its widgets in one call (`widgets/query` accepts up to 40 queries) and identical queries are executed once.
- **Limits.** Per ADR-0003: caps on rows and buckets, a statement timeout, and a per-user rate limit on the query endpoint.
- **Templates** are `DashboardDoc` JSON files in `packages/ui/widgets/templates/`: `classic` (the M1 dashboard: income, expenses with per-day average, expense count and net as stats, category pie, category table, recent expenses table), `monthly-trends` (line of spending by month, bar by category with previous-period compare), and `budget-check` (budget-versus-actual plus stats).
- **Default.** A user's first visit to a budget's dashboard creates a default dashboard from `classic`. The M1 fixed dashboard page is removed; `reports/summary` stays in the API for other clients.
- **Mobile.** Below the small breakpoint the grid is a single column in reading order, and editing layout is disabled (configure widgets, yes; drag and resize, no).

## API endpoints

| Method | Path | Purpose | Authz |
|---|---|---|---|
| GET | `/api/v1/widget-types` | The registry's types with their JSON Schemas and default specs, for clients and for the AI tool in M7 | Authenticated. Static metadata; no budget data. |
| POST | `/api/v1/budgets/{budgetId}/widgets/query` | Run 1 to 40 queries `{ queries: [...], dateRange? }` → results in the same order; a failed query returns an error object in its slot | Member. The budget comes only from the path; category IDs in a query are resolved inside this budget and foreign IDs match nothing. Never writes. |
| POST | `/api/v1/budgets/{budgetId}/widgets/validate` | Validate a `WidgetSpec` without running it; returns issues | Member |
| GET | `/api/v1/budgets/{budgetId}/dashboards` | The caller's dashboards for this budget | Member; filtered to `user_id` = caller |
| POST | `/api/v1/budgets/{budgetId}/dashboards` | Create `{ name, doc? , templateId? }` | Member (viewers may arrange their own dashboards; a dashboard is a personal view, not budget data) |
| GET | `/api/v1/budgets/{budgetId}/dashboards/{dashboardId}` | Get one | Member, and the dashboard's `user_id` must be the caller (`404` otherwise) |
| PUT | `/api/v1/budgets/{budgetId}/dashboards/{dashboardId}` | Replace `name`, `doc`, `isDefault`. Uses `updatedAt` as a precondition; a stale write returns `409`. | Member, and owner of the dashboard (`404` otherwise) |
| DELETE | `/api/v1/budgets/{budgetId}/dashboards/{dashboardId}` | Delete; if it was the default, the most recently updated remaining one becomes default | Member, and owner of the dashboard (`404` otherwise) |
| GET | `/api/v1/dashboard-templates` | List templates with their docs | Authenticated. Static. |
| GET | `/api/v1/budgets/{budgetId}/category-targets` | List targets | Member |
| PUT | `/api/v1/budgets/{budgetId}/category-targets/{categoryId}` | Set `{ amountCents }` for a category | Editor; category must belong to the budget |
| DELETE | `/api/v1/budgets/{budgetId}/category-targets/{categoryId}` | Remove a target | Editor; category must belong to the budget |

When a member is removed from a budget (M4), their dashboards for it are deleted.

## UI

- **Dashboard page:** dashboard picker (switch, new from template or blank, rename, duplicate, delete, set default), the date range control, and the grid.
- **Edit mode:** toggled by a button. Drag to move, drag a corner to resize, a "+" to add a widget from a gallery of types with previews, and per-widget menu (configure, duplicate, remove). Changes save automatically with an undo for the last change. Leaving edit mode locks the grid.
- **Configuration form:** generated from the type's schema: title, data (type filter, categories, date range or "follow dashboard", group by, measure, sort, limit, compare), and display options. A live preview updates as fields change. An "Advanced" tab shows the spec as JSON, editable, validated on every keystroke; this is the path that proves a spec can come from anywhere.
- **Category targets:** a column on the categories page to set a monthly target.
- **States:** loading skeleton per widget, empty state ("No data in this range"), inline error card.
- Charts have accessible names, and each chart offers "view as table".

## Acceptance tests

### Authz matrix

The M1 matrix extends to every endpoint above with a `{budgetId}`. In addition:

- `M6-AZ-1` User A cannot read, replace or delete user B's dashboard in a budget they both belong to (`404`).
- `M6-AZ-2` A query run in budget A with `categoryIds` belonging to budget B returns no data for those IDs and the same shape as for an unknown ID.
- `M6-AZ-3` A query body containing a `budgetId` field, or any unknown field, is rejected with `422` (strict schema).
- `M6-AZ-4` Two budgets with different data: the same query against each returns each budget's own totals (run for every `groupBy` and `measure`).
- `M6-AZ-5` A viewer can run queries and manage their own dashboards, and cannot set category targets (`403`).
- `M6-AZ-6` Static test: the query compiler module contains no raw SQL string built from spec values.

### Unit (Vitest)

- `M6-U-1` Spec schema: one valid fixture per widget type parses; each type rejects a query shape it does not support (for example `line` with `groupBy: "category"`); unknown fields are rejected; limits are enforced.
- `M6-U-2` Date presets resolve to the right inclusive ranges for fixed "today" values, including month and year boundaries and a leap day.
- `M6-U-3` Compiler and executor against a fixture database: each `groupBy` × `measure` gives hand-computed results; time buckets with no data are zero-filled; `compare: "previous_period"` uses the immediately preceding range of equal length; `maxItems` merges the tail into "Other"; `nameContains` with `%` and `_` is matched literally.
- `M6-U-4` `rows` measure honours sort and limit.
- `M6-U-5` Budget-versus-actual: whole-month range; pro-rating for a partial month; a category with a target and no spending; spending with no target.
- `M6-U-6` Every template validates against `DashboardDoc`, and `classic` over a fixture matches `reports/summary` for the same range.
- `M6-U-7` Renderers: each renders a fixture result without errors (component test), renders the empty state for an empty series, and renders a title containing `<script>` as text.

### API behaviour (Vitest)

- `M6-API-1` Dashboard create from template, get, replace, delete; default handling; the 21st dashboard is refused.
- `M6-API-2` A stale `PUT` (older `updatedAt`) returns `409` and does not overwrite.
- `M6-API-3` Saving a doc with an invalid widget spec returns `422` naming the widget index and field.
- `M6-API-4` Batch query: 40 queries succeed; 41 is refused; one invalid query yields an error in its slot and results for the others.
- `M6-API-5` A dashboard-level range overrides widget ranges except for locked widgets.
- `M6-API-6` First visit creates a default dashboard from `classic` exactly once (concurrent requests do not create two).
- `M6-API-7` Removing a member deletes their dashboards for that budget.

### End to end (Playwright)

- `M6-E-1` A new user sees the classic dashboard with correct numbers for seeded data.
- `M6-E-2` Enter edit mode → add a bar widget "spending by category this month" through the form → it shows the right bars → drag it to a new position and resize → reload → layout and widget persist.
- `M6-E-3` Paste a spec into the Advanced tab → the widget renders; paste an invalid spec → the validation message is shown and nothing is saved.
- `M6-E-4` Change the dashboard date range → all unlocked widgets update.
- `M6-E-5` Create a second dashboard from a template, set it as default, reload → it opens first.
- `M6-E-6` Set a monthly target on a category → the budget-versus-actual widget shows target, actual and remaining.
- `M6-E-7` Mobile viewport: widgets stack in one column with no horizontal scroll.

## Demo end state

The owner rearranges their dashboard, adds a monthly trend line and a budget-versus-actual widget, and keeps a second dashboard just for groceries. A widget spec pasted as JSON renders without any code change, which is the hook for the AI milestone.

## Devlog prompt

Film and write: designing a query language small enough to be safe and big enough to be useful, with ADR-0003 on screen; the test where a spec tries to reach another budget and cannot; building a dashboard on camera; the Advanced tab as a preview of M7. Cover what the agent over-built (a general expression language?) or under-built, and how the spec's constraints steered it.

## Locked decisions covered

Dashboards (widget registry, per-user saved layouts with react-grid-layout, one declarative spec shared with AI generation).
