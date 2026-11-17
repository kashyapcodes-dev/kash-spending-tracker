"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  DATE_PRESETS,
  MAX_WIDGETS,
  widgetSpecSchema,
  type Dashboard,
  type DashboardDoc,
  type DateRange,
  type QuerySlot,
  type WidgetSpec,
  type WidgetType,
  WIDGET_TYPES,
} from "@kash/contract";
import { InvalidWidget, WidgetView, widgetRegistry } from "@kash/ui/widgets";
import { ApiError } from "@kash/api-client";
import { Button } from "@/components/ui/button";
import { ErrorText, Input, Select } from "@/components/ui";
import { WidgetEditor } from "@/components/widget-editor";
import { useBudget, useLoad } from "@/components/use-budget";
import { api } from "@/lib/api";
import { todayLocal } from "@/lib/format";
import { DATA_CHANGED, currentCacheEpoch } from "@/lib/pwa";
import { loadSlots, saveSlots } from "@/lib/widget-cache";

const Grid = WidthProvider(GridLayout);
type Item = DashboardDoc["widgets"][number];

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 767px)");
    const f = () => setMobile(q.matches);
    f();
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, []);
  return mobile;
}

const rangeKey = (r: DateRange) =>
  "preset" in r ? r.preset : `${r.from}..${r.to}`;

export function DashboardView({ budgetId }: { budgetId: string }) {
  const { currency, canWrite } = useBudget(budgetId);
  const mobile = useIsMobile();
  const list = useLoad(
    () => api.listDashboards({ params: { budgetId } }),
    [budgetId],
  );
  const [activeId, setActiveId] = useState<string>();
  const [doc, setDoc] = useState<DashboardDoc>();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<DashboardDoc[]>([]);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(true);
  const [slots, setSlots] = useState<QuerySlot[]>();
  const [editor, setEditor] = useState<{ id?: string; spec: WidgetSpec }>();
  const [tick, setTick] = useState(0);
  const stamp = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const items = list.data?.items;
  const active: Dashboard | undefined = useMemo(
    () =>
      items?.find(d => d.id === activeId) ??
      items?.find(d => d.isDefault) ??
      items?.[0],
    [items, activeId],
  );

  // Load the working copy when the active dashboard changes.
  useEffect(() => {
    if (!active) return;
    setActiveId(active.id);
    setDoc(active.doc);
    setName(active.name);
    stamp.current = active.updatedAt;
    setHistory([]);
    setSaved(true);
    setConflict(false);
  }, [active?.id]);

  const canEdit = canWrite && !mobile;
  const edit = canEdit && editing;

  const save = useCallback(
    async (next: DashboardDoc, nextName: string) => {
      if (!active) return;
      try {
        const d = await api.replaceDashboard({
          params: { budgetId, dashboardId: active.id },
          body: {
            name: nextName,
            doc: next,
            isDefault: active.isDefault,
            updatedAt: stamp.current,
          },
        });
        stamp.current = d.updatedAt;
        setSaved(true);
        setSaveError(undefined);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setConflict(true);
        else setSaveError(e instanceof Error ? e.message : "Could not save");
      }
    },
    [active?.id, active?.isDefault, budgetId],
  );

  const change = (next: DashboardDoc, nextName = name) => {
    if (!doc) return;
    setHistory(h => [...h.slice(-30), doc]);
    setDoc(next);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next, nextName), 800);
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(h => h.slice(0, -1));
    setDoc(prev);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(prev, name), 800);
  };

  useEffect(() => {
    const f = () => setTick(t => t + 1);
    window.addEventListener(DATA_CHANGED, f);
    return () => window.removeEventListener(DATA_CHANGED, f);
  }, []);

  // Batch-run every widget query with the dashboard range.
  const queries = useMemo(
    () => (doc?.widgets ?? []).map(w => w.spec.query),
    [JSON.stringify(doc?.widgets.map(w => w.spec.query))],
  );
  useEffect(() => {
    if (!doc) return;
    if (queries.length === 0) {
      setSlots([]);
      return;
    }
    let live = true;
    const key = `${budgetId}/${active?.id}/${rangeKey(doc.dateRange)}/${queries.length}`;
    if (tick === 0) setSlots(undefined);
    const epoch = currentCacheEpoch();
    api
      .queryWidgets({
        params: { budgetId },
        body: { queries, dateRange: doc.dateRange, today: todayLocal() },
      })
      .then(
        r => {
          if (!live) return;
          setSlots(r.results);
          void saveSlots(key, r.results, epoch);
        },
        async e => {
          // Offline or failing: show the last saved results when there are some.
          const cached = await loadSlots(key);
          if (!live) return;
          setSlots(
            cached ??
              queries.map(() => ({
                error: { message: e instanceof Error ? e.message : "Failed" },
              })),
          );
        },
      );
    return () => {
      live = false;
    };
  }, [queries, doc && rangeKey(doc.dateRange), budgetId, tick, active?.id]);

  if (list.error) return <ErrorText>{list.error}</ErrorText>;
  if (!active || !doc) return <p role="status">Loading dashboard…</p>;

  const addWidget = (type: WidgetType) => {
    if (doc.widgets.length >= MAX_WIDGETS) return;
    const spec = widgetSpecSchema.parse(widgetRegistry[type].defaultSpec);
    setEditor({ spec });
  };
  const commitWidget = (spec: WidgetSpec, id?: string) => {
    if (id) {
      change({
        ...doc,
        widgets: doc.widgets.map(w => (w.id === id ? { ...w, spec } : w)),
      });
    } else {
      const size = widgetRegistry[spec.type].defaultSize;
      const y = doc.widgets.reduce(
        (m, w) => Math.max(m, w.layout.y + w.layout.h),
        0,
      );
      change({
        ...doc,
        widgets: [
          ...doc.widgets,
          { id: crypto.randomUUID(), layout: { x: 0, y, ...size }, spec },
        ],
      });
    }
    setEditor(undefined);
  };
  const onLayout = (layout: Layout[]) => {
    if (!edit) return;
    const changed = layout.some(l => {
      const w = doc.widgets.find(x => x.id === l.i);
      return (
        w &&
        (w.layout.x !== l.x ||
          w.layout.y !== l.y ||
          w.layout.w !== l.w ||
          w.layout.h !== l.h)
      );
    });
    if (!changed) return;
    change({
      ...doc,
      widgets: doc.widgets.map(w => {
        const l = layout.find(x => x.i === w.id);
        return l ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w;
      }),
    });
  };

  const refresh = async (select?: string) => {
    if (select) setActiveId(select);
    list.reload();
  };
  const createFrom = async (
    templateId?: "classic" | "monthly-trends" | "budget-check",
  ) => {
    const n = window.prompt("Dashboard name", "New dashboard");
    if (!n) return;
    const d = await api.createDashboard({
      params: { budgetId },
      body: templateId
        ? { name: n, templateId }
        : {
            name: n,
            doc: {
              version: 1,
              dateRange: { preset: "this_month" },
              widgets: [],
            },
          },
    });
    await refresh(d.id);
  };
  const duplicate = async () => {
    const d = await api.createDashboard({
      params: { budgetId },
      body: { name: `${name} copy`, doc },
    });
    await refresh(d.id);
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    await api.deleteDashboard({ params: { budgetId, dashboardId: active.id } });
    setActiveId(undefined);
    await refresh();
  };
  const makeDefault = async () => {
    await api.replaceDashboard({
      params: { budgetId, dashboardId: active.id },
      body: { name, doc, isDefault: true, updatedAt: stamp.current },
    });
    await refresh(active.id);
  };

  const range = doc.dateRange;
  const customRange = "from" in range;
  const layout: Layout[] = doc.widgets.map(w => ({
    i: w.id,
    ...w.layout,
    minW: widgetRegistry[w.spec.type].minSize.w,
    minH: widgetRegistry[w.spec.type].minSize.h,
  }));
  const render = (w: Item, i: number) => {
    const parsed = widgetSpecSchema.safeParse(w.spec);
    return (
      <div key={w.id} data-testid={`widget-${w.spec.title}`}>
        {parsed.success ? (
          <WidgetView
            spec={parsed.data}
            slot={slots?.[i]}
            currency={currency}
          />
        ) : (
          <InvalidWidget
            message={parsed.error.issues[0]?.message ?? "invalid"}
          />
        )}
        {edit ? (
          <div className="absolute right-2 top-2 flex gap-1 rounded bg-background/90 p-1 text-xs">
            <button
              type="button"
              aria-label={`Edit ${w.spec.title}`}
              onClick={() => setEditor({ id: w.id, spec: w.spec })}
            >
              Edit
            </button>
            <button
              type="button"
              aria-label={`Remove ${w.spec.title}`}
              onClick={() =>
                change({
                  ...doc,
                  widgets: doc.widgets.filter(x => x.id !== w.id),
                })
              }
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold">Dashboard</h1>
        <Select
          aria-label="Dashboard"
          className="w-48"
          value={active.id}
          onChange={e => setActiveId(e.target.value)}
        >
          {items?.map(d => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.isDefault ? " (default)" : ""}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Date range"
          className="w-40"
          value={customRange ? "custom" : (range as { preset: string }).preset}
          onChange={e =>
            change({
              ...doc,
              dateRange:
                e.target.value === "custom"
                  ? { from: `${todayLocal().slice(0, 8)}01`, to: todayLocal() }
                  : { preset: e.target.value as (typeof DATE_PRESETS)[number] },
            })
          }
        >
          {DATE_PRESETS.map(p => (
            <option key={p} value={p}>
              {p.replaceAll("_", " ")}
            </option>
          ))}
          <option value="custom">custom</option>
        </Select>
        {customRange ? (
          <>
            <Input
              type="date"
              aria-label="From"
              className="w-40"
              value={range.from}
              onChange={e =>
                change({
                  ...doc,
                  dateRange: { from: e.target.value, to: range.to },
                })
              }
            />
            <Input
              type="date"
              aria-label="To"
              className="w-40"
              value={range.to}
              onChange={e =>
                change({
                  ...doc,
                  dateRange: { from: range.from, to: e.target.value },
                })
              }
            />
          </>
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(v => !v)}
          >
            {editing ? "Done" : "Edit dashboard"}
          </Button>
        ) : null}
        <span role="status" className="text-xs text-muted-foreground">
          {saved ? "Saved" : "Saving…"}
        </span>
      </div>

      {conflict ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900"
        >
          This dashboard changed elsewhere.
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setConflict(false);
              list.reload();
              setActiveId(undefined);
            }}
          >
            Reload
          </Button>
        </div>
      ) : null}
      <ErrorText>{saveError}</ErrorText>

      {edit ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm">
          <Input
            aria-label="Dashboard name"
            className="w-48"
            value={name}
            onChange={e => {
              setName(e.target.value);
              clearTimeout(timer.current);
              setSaved(false);
              timer.current = setTimeout(
                () => void save(doc, e.target.value),
                800,
              );
            }}
          />
          <Select
            aria-label="Add widget"
            className="w-44"
            value=""
            onChange={e =>
              e.target.value && addWidget(e.target.value as WidgetType)
            }
          >
            <option value="">Add widget…</option>
            {WIDGET_TYPES.map(t => (
              <option key={t} value={t}>
                {widgetRegistry[t].label}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={history.length === 0}
            onClick={undo}
          >
            Undo
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void createFrom("classic")}
          >
            New from Classic
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void createFrom("monthly-trends")}
          >
            New from Monthly trends
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void createFrom("budget-check")}
          >
            New from Budget check
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void createFrom()}
          >
            New blank
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void duplicate()}
          >
            Duplicate
          </Button>
          {!active.isDefault ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void makeDefault()}
            >
              Make default
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      ) : null}

      {doc.widgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No widgets yet. Choose Edit dashboard, then add one.
        </p>
      ) : mobile ? (
        <div className="flex flex-col gap-3">
          {doc.widgets
            .map((w, i) => ({ w, i }))
            .sort(
              (a, b) =>
                a.w.layout.y - b.w.layout.y || a.w.layout.x - b.w.layout.x,
            )
            .map(({ w, i }) => (
              <div key={w.id} className="h-64">
                {render(w, i)}
              </div>
            ))}
        </div>
      ) : (
        <Grid
          layout={layout}
          cols={12}
          rowHeight={60}
          isDraggable={edit}
          isResizable={edit}
          onLayoutChange={onLayout}
          draggableCancel="button"
        >
          {doc.widgets.map(render)}
        </Grid>
      )}

      {editor ? (
        <WidgetEditor
          budgetId={budgetId}
          currency={currency}
          initial={editor.spec}
          onCancel={() => setEditor(undefined)}
          onSave={spec => commitWidget(spec, editor.id)}
        />
      ) : null}
    </section>
  );
}
