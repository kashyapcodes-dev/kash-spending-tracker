import { describe, expect, it } from "vitest";
import { z } from "zod";
import { endpoints } from "./endpoints";

type Def = { type: string; [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- zod internals have no public type

/** Collect paths of strings and arrays that have no maximum length. */
function unbounded(
  schema: z.ZodType,
  path: string,
  out: string[],
  seen = new Set<unknown>(),
) {
  if (seen.has(schema)) return;
  seen.add(schema);
  const def = (schema as unknown as { _zod: { def: Def } })._zod.def;
  const s = schema as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- zod internals
  switch (def.type) {
    case "string":
      // UUIDs and ISO dates have a fixed shape and so a fixed length.
      if (
        s.maxLength == null &&
        !/^(uuid|guid|iso_datetime|iso_date|iso_time|date|datetime)$/.test(
          String(def.format ?? ""),
        )
      )
        out.push(path);
      return;
    case "array":
      if (
        !((def.checks ?? []) as { _zod: { def: Def } }[]).some(
          c => c._zod.def.check === "max_length",
        )
      )
        out.push(`${path}[]`);
      unbounded(def.element, `${path}[]`, out, seen);
      return;
    case "object":
      for (const [k, v] of Object.entries(
        def.shape as Record<string, z.ZodType>,
      ))
        unbounded(v, `${path}.${k}`, out, seen);
      return;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
      return unbounded(def.innerType, path, out, seen);
    case "pipe":
      return unbounded(def.in, path, out, seen);
    case "union":
      for (const o of def.options as z.ZodType[]) unbounded(o, path, out, seen);
      return;
    case "record":
      unbounded(def.valueType, `${path}{}`, out, seen);
      return;
    case "tuple":
      for (const o of def.items as z.ZodType[]) unbounded(o, path, out, seen);
      return;
    case "lazy":
      return unbounded(def.getter(), path, out, seen);
    default:
      return;
  }
}

describe("M9-U-11 every request string and array has a maximum", () => {
  it("names offenders", () => {
    const offenders: string[] = [];
    for (const e of endpoints as unknown as {
      id: string;
      body?: z.ZodType;
      query?: z.ZodType;
      params?: z.ZodType;
    }[]) {
      for (const part of ["body", "query", "params"] as const) {
        const sch = e[part];
        if (!sch) continue;
        const found: string[] = [];
        unbounded(sch, `${e.id}.${part}`, found);
        offenders.push(...found);
      }
    }
    expect(offenders).toEqual([]);
  });
});
