import { z } from "zod";
import {
  AppError,
  clientIp,
  isAppError,
  type Actor,
  type Services,
  type TrustedProxy,
} from "@kash/core";
import {
  ERROR_STATUS,
  endpoints,
  type EndpointId,
  type ErrorResponse,
} from "@kash/contract";
import { getContainer } from "./container";
import { CSV_LIMIT, JSON_LIMIT, csrfRejected, readBounded } from "./security";

type Def<K extends EndpointId> = Extract<(typeof endpoints)[number], { id: K }>;
type Parsed<D, F extends string> =
  D extends Record<F, infer S extends z.ZodType> ? z.output<S> : undefined;

export interface HandlerArgs<K extends EndpointId> {
  actor: Actor;
  services: Services;
  params: Parsed<Def<K>, "params">;
  query: Parsed<Def<K>, "query">;
  body: Parsed<Def<K>, "body">;
  request: Request;
  /** Set when the request authenticated with a personal access token instead of a session. */
  token: { scope: "read" | "read_propose"; budgetIds: string[] | null } | null;
}

/**
 * What a personal access token may call (M7). Reads, the widget query and validate POSTs, and,
 * with scope read_propose, proposal creation. Approving, tokens, members, invites, bank
 * connections, chat and the audit log are never reachable with a token.
 */
const TOKEN_POSTS = new Set(["queryWidgets", "validateWidget"]);
const TOKEN_BLOCKED_PATH =
  /\/(members|invites|bank-connections|agent-audit|ai\/conversations|me\/tokens|me\/sessions|me\/verification)(\/|$)/;
function tokenAllows(
  def: { id: string; path: string; method?: string },
  method: string,
  scope: "read" | "read_propose",
): boolean {
  if (TOKEN_BLOCKED_PATH.test(def.path)) return false;
  if (method === "GET") return true;
  if (TOKEN_POSTS.has(def.id)) return true;
  return def.id === "createProposal" && scope === "read_propose";
}

type Result<K extends EndpointId> =
  Def<K>["success"]["schema"] extends z.ZodType<infer O> ? O : never;
const LIMITS = { userPerMinute: 120, ipPerMinute: 240, previewPerMinute: 30 };

/** Per-user, per-minute limits for the costly or abusable endpoints (M9 scope 2). */
const COSTLY: Record<string, number> = {
  createToken: 10,
  analyzeCsv: 20,
  importCsvPreview: 20,
  stageCsv: 20,
  queryWidgets: 120,
  sendMessage: 20,
  startBankLink: 10,
  completeBankLink: 10,
  syncBankConnection: 10,
};

/** With REQUIRE_EMAIL_VERIFICATION, an unverified account may only call these. */
const UNVERIFIED_OK = new Set([
  "me",
  "resendVerification",
  "signOutEverywhere",
]);

/** Members and invites are rate limited per user and per IP (ADR-0009). */
function limitKeys(
  path: string,
  request: Request,
  trust: TrustedProxy,
  userId?: string,
): [string, number][] {
  const ip = clientIp(request.headers, trust);
  if (path.startsWith("/api/v1/invites/"))
    return [[`invite-token:ip:${ip}`, LIMITS.previewPerMinute]];
  if (!path.includes("/members") && !path.includes("/invites")) return [];
  const keys: [string, number][] = [[`members:ip:${ip}`, LIMITS.ipPerMinute]];
  if (userId) keys.push([`members:user:${userId}`, LIMITS.userPerMinute]);
  return keys;
}
type RouteContext = { params: Promise<Record<string, string>> };

const json = (status: number, body: ErrorResponse) =>
  Response.json(body, { status });
const fail = (
  code: ErrorResponse["error"]["code"],
  message: string,
  details?: unknown,
) =>
  json(ERROR_STATUS[code], {
    error: { code, message, ...(details === undefined ? {} : { details }) },
  });

async function readBody(
  request: Request,
  multipart: boolean,
): Promise<unknown> {
  if (multipart) {
    const bytes = await readBounded(request, CSV_LIMIT);
    // Rebuild a Request from the bounded bytes so formData() never sees more than the cap.
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: Buffer.from(bytes),
    }).formData();
  }
  const bytes = await readBounded(request, JSON_LIMIT);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new AppError("validation_failed", "Request body must be JSON");
  }
}

/**
 * Wrap a route handler: session -> actor, origin check, zod parsing from the contract,
 * error mapping, and the success status from the contract. Handlers contain no data access.
 */
export function handle<K extends EndpointId>(
  id: K,
  run: (args: HandlerArgs<K>) => Promise<Result<K> | Response | void>,
) {
  const def = endpoints.find(e => e.id === id) as unknown as {
    id: string;
    access: string;
    path: string;
    params?: z.ZodType;
    query?: z.ZodType;
    body?: z.ZodType;
    bodyKind?: string;
    success: { status: number };
  };

  return async (request: Request, context: RouteContext): Promise<Response> => {
    try {
      const container = getContainer();
      const hasBearer = /^Bearer\s+\S+$/i.test(
        request.headers.get("authorization") ?? "",
      );
      if (csrfRejected(request, container.appUrl, hasBearer))
        return fail("forbidden", "Cross-site request refused");

      let actor: Actor | undefined;
      let unverified = false;
      let token: HandlerArgs<K>["token"] = null;
      if (def.access !== "public") {
        const bearer = /^Bearer\s+(\S+)$/i.exec(
          request.headers.get("authorization") ?? "",
        )?.[1];
        if (bearer) {
          const verified = await container.services.tokens.verify(bearer);
          if (!verified)
            return fail("unauthenticated", "Invalid or expired token");
          if (!tokenAllows(def, request.method, verified.scope))
            return fail("forbidden", "This token cannot do that");
          actor = { userId: verified.userId };
          token = { scope: verified.scope, budgetIds: verified.budgetIds };
        } else {
          const session = await container.auth.api.getSession({
            headers: request.headers,
          });
          if (!session) return fail("unauthenticated", "Sign in required");
          actor = { userId: session.user.id };
          unverified =
            container.requireVerification && !session.user.emailVerified;
        }
      }

      const costly = COSTLY[def.id];
      if (costly && actor) {
        const r = container.limiter.hit(
          `${def.id}:user:${actor.userId}`,
          costly,
        );
        if (!r.ok)
          return Response.json(
            { error: { code: "rate_limited", message: "Too many requests" } },
            {
              status: 429,
              headers: { "retry-after": String(r.retryAfterSeconds) },
            },
          );
      }
      for (const [key, limit] of limitKeys(
        def.path,
        request,
        container.trustedProxy,
        actor?.userId,
      )) {
        const r = container.limiter.hit(key, limit);
        if (!r.ok)
          return Response.json(
            { error: { code: "rate_limited", message: "Too many requests" } },
            {
              status: 429,
              headers: { "retry-after": String(r.retryAfterSeconds) },
            },
          );
      }

      const parse = (schema: z.ZodType | undefined, value: unknown) => {
        if (!schema) return undefined;
        const r = schema.safeParse(value);
        if (!r.success)
          throw new AppError(
            "validation_failed",
            "Invalid request",
            r.error.issues,
          );
        return r.data;
      };
      const params = parse(def.params, await context.params);
      // A budget-limited token sees other budgets as missing (the membership check still runs).
      const limited = token?.budgetIds;
      const pid = (params as { budgetId?: string } | undefined)?.budgetId;
      if (limited && pid && !limited.includes(pid))
        return fail("not_found", "Budget not found");
      // Verification gate. Membership is checked first so a non-member still gets 404 and the
      // gate never reveals which budgets exist (M9-AZ-4).
      if (unverified && actor && !UNVERIFIED_OK.has(def.id)) {
        if (pid) await container.services.budgets.get(actor, pid);
        return fail(
          "email_unverified",
          "Verify your email address to continue",
        );
      }
      const query = parse(
        def.query,
        Object.fromEntries(new URL(request.url).searchParams),
      );
      let body: unknown;
      if (def.bodyKind === "multipart") body = await readBody(request, true);
      else if (def.body) body = parse(def.body, await readBody(request, false));

      const data = await run({
        actor: actor as Actor,
        services: container.services,
        params,
        query,
        body,
        request,
        token,
      } as HandlerArgs<K>);

      // Streaming routes return their own Response (server-sent events).
      if (data instanceof Response) return data;
      if (def.success.status === 204)
        return new Response(null, { status: 204 });
      return Response.json(data, { status: def.success.status });
    } catch (e) {
      if (isAppError(e)) return fail(e.code, e.message, e.details);
      console.error("[kash] unhandled error", e);
      return fail("internal", "Something went wrong");
    }
  };
}
