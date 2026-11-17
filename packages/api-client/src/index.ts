/**
 * Typed client derived from the endpoint registry in @kash/contract. There is no
 * hand-written request or response type here: adding an endpoint to the contract adds a method.
 */
import type { z } from "zod";
import { endpoints, type ErrorCode, type EndpointId } from "@kash/contract";

type Def<K extends EndpointId> = Extract<(typeof endpoints)[number], { id: K }>;
type Input<D, F extends string> =
  D extends Record<F, infer S extends z.ZodType> ? z.input<S> : never;
type Output<D> = D extends { success: { schema: infer S extends z.ZodType } }
  ? z.output<S>
  : never;

type Options<K extends EndpointId> = ([Input<Def<K>, "params">] extends [never]
  ? object
  : { params: Input<Def<K>, "params"> }) &
  ([Input<Def<K>, "query">] extends [never]
    ? object
    : { query?: Input<Def<K>, "query"> }) &
  ([Input<Def<K>, "body">] extends [never]
    ? object
    : { body: Input<Def<K>, "body"> }) &
  (Def<K> extends { bodyKind: "multipart" }
    ? { file: Blob; fields?: Record<string, string> }
    : object);

export type ApiClient = {
  [K in EndpointId]: keyof Options<K> extends never
    ? () => Promise<Output<Def<K>>>
    : (options: Options<K>) => Promise<Output<Def<K>>>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Extra headers on every request, for example a cookie when calling from the server. */
  headers?: () => HeadersInit | Promise<HeadersInit>;
}

interface Call {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  file?: Blob;
  fields?: Record<string, string>;
}

export function createApiClient(options: ClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? fetch;
  const client: Record<string, (call?: Call) => Promise<unknown>> = {};

  for (const def of endpoints) {
    client[def.id] = async (call: Call = {}) => {
      let path: string = def.path;
      for (const [k, v] of Object.entries(call.params ?? {}))
        path = path.replace(`{${k}}`, encodeURIComponent(v));
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(call.query ?? {}))
        if (v !== undefined && v !== null) search.set(k, String(v));
      const url = `${options.baseUrl ?? ""}${path}${search.size > 0 ? `?${search}` : ""}`;

      const headers = new Headers(
        options.headers ? await options.headers() : undefined,
      );
      let body: BodyInit | undefined;
      if ("bodyKind" in def && def.bodyKind === "multipart" && call.file) {
        const form = new FormData();
        form.set("file", call.file);
        for (const [k, v] of Object.entries(call.fields ?? {})) form.set(k, v);
        body = form;
      } else if (call.body !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(call.body);
      }

      const res = await doFetch(url, {
        method: def.method.toUpperCase(),
        headers,
        body,
        credentials: "same-origin",
      });
      if (res.status === 204) return null;
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const e = (
          json as {
            error?: { code?: ErrorCode; message?: string; details?: unknown };
          } | null
        )?.error;
        // A rate-limited answer tells the user how long to wait.
        const wait = Number(res.headers.get("retry-after"));
        const message =
          res.status === 429 && Number.isFinite(wait) && wait > 0
            ? `Too many attempts. Try again in ${
                wait >= 60
                  ? `${Math.ceil(wait / 60)} minutes`
                  : `${wait} seconds`
              }.`
            : (e?.message ?? res.statusText);
        throw new ApiError(
          res.status,
          e?.code ?? "internal",
          message,
          e?.details,
        );
      }
      return def.success.schema.parse(json);
    };
  }
  return client as unknown as ApiClient;
}
