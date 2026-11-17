import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { schema, type Database } from "@kash/db";
import { hasUsableInvite, insertBudgetWithOwner } from "../services";
import { authThrottle } from "./throttle";

export * from "./throttle";

/** Internal header carrying the computed client IP into Better Auth. */
export const CLIENT_IP_HEADER = "x-kash-client-ip";

export interface AuthOptions {
  db: Database;
  /** Used to sign sessions and tokens. Required. */
  secret: string;
  /** Public origin of the app, for example `http://localhost:3000`. */
  baseURL: string;
  /** Delivers password-reset links. With no SMTP configured, the caller logs the link instead. */
  sendResetPassword: (args: {
    email: string;
    url: string;
  }) => void | Promise<void>;
  /** Extra origins allowed to call the auth endpoints (tests, preview deployments). */
  trustedOrigins?: string[];
  /**
   * Better Auth rate-limits sign-in and sign-up per IP by default (production). Leave this
   * unset in real deployments; end-to-end tests turn it off because every signup shares one IP.
   */
  disableRateLimit?: boolean;
  /** When set, sign-up sends a verification email (M9 scope 3). */
  sendVerificationEmail?: (args: {
    email: string;
    url: string;
  }) => void | Promise<void>;
  /** Test seam for lockout timing. */
  now?: () => number;
  /** `closed`: no new accounts once one exists. The first account can always be created. */
  signupMode?: "open" | "closed";
}

/** Signups are allowed when the instance is open, or when it is closed but has no users yet. */
export async function isSignupAllowed(
  db: Database,
  mode: "open" | "closed",
  /** An address with a usable invite may sign up even when the instance is closed (M4). */
  email?: string,
): Promise<boolean> {
  if (mode === "open") return true;
  if (email && (await hasUsableInvite(db, email))) return true;
  const [row] = await db.select({ n: count() }).from(schema.user);
  return (row?.n ?? 0) === 0;
}

/** Revoke every personal access token of a user. Returns how many were revoked. */
export async function revokeUserTokens(
  db: Database,
  userId: string,
): Promise<number> {
  const t = schema.apiTokens;
  const rows = await db
    .update(t)
    .set({ revokedAt: new Date() })
    .where(and(eq(t.userId, userId), isNull(t.revokedAt)))
    .returning({ id: t.id });
  return rows.length;
}

/** Sign out everywhere: delete all of the user's sessions and revoke all of their tokens. */
export async function signOutEverywhere(
  db: Database,
  userId: string,
): Promise<void> {
  await db.delete(schema.session).where(eq(schema.session.userId, userId));
  await revokeUserTokens(db, userId);
}

/** Better Auth instance: email and password, Drizzle on Postgres, and a default budget on signup. */
export function createAuth(options: AuthOptions) {
  const { db } = options;
  const throttle = authThrottle(db, options.secret, options.now);
  const verify = options.sendVerificationEmail;
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [options.baseURL, ...(options.trustedOrigins ?? [])],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // The app computes the client IP itself (client-ip.ts) and passes it in this header,
    // so Better Auth never reads a client-supplied X-Forwarded-For.
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    ...(options.disableRateLimit ? { rateLimit: { enabled: false } } : {}),
    ...(verify
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            expiresIn: 3600,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => {
              // Not awaited: timing must not reveal whether an address exists.
              void Promise.resolve(verify({ email: user.email, url })).catch(
                () => undefined,
              );
            },
          },
        }
      : {}),
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path === "/sign-in/email") {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email === "string") {
            const secs = await throttle.lockedFor(email);
            if (secs > 0)
              throw new APIError(
                "TOO_MANY_REQUESTS",
                {
                  message: `Too many attempts. Try again in ${Math.ceil(secs / 60)} minute${secs > 60 ? "s" : ""}.`,
                  code: "TOO_MANY_ATTEMPTS",
                },
                { "retry-after": String(secs) },
              );
          }
        }
        // Changing a password always signs out the other sessions.
        if (ctx.path === "/change-password")
          return {
            context: {
              ...ctx,
              body: { ...(ctx.body as object), revokeOtherSessions: true },
            },
          };
      }),
      after: createAuthMiddleware(async ctx => {
        const returned = ctx.context.returned;
        const failed = returned instanceof APIError;
        if (ctx.path === "/sign-in/email") {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email !== "string") return;
          if (failed) await throttle.recordFailure(email);
          else await throttle.clear(email);
        }
        if (ctx.path === "/change-password" && !failed) {
          const id = (returned as { user?: { id?: string } } | null)?.user?.id;
          if (id) await revokeUserTokens(db, id);
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // One hour, single use (Better Auth consumes the token on use), and a reset ends every session.
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }: { user: { id: string } }) => {
        await revokeUserTokens(db, user.id);
      },
      sendResetPassword: async ({ user, url }) => {
        // Not awaited: awaiting leaks whether the address exists through response timing.
        void Promise.resolve(
          options.sendResetPassword({ email: user.email, url }),
        ).catch(() => undefined);
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async user => {
            if (
              !(await isSignupAllowed(
                db,
                options.signupMode ?? "open",
                user.email,
              ))
            ) {
              throw new APIError("FORBIDDEN", {
                message: "Signups are closed on this instance",
              });
            }
          },
          // Better Auth runs this after the user insert has committed, so it cannot share that
          // transaction. If the budget cannot be created, the user is removed again: signup
          // fails cleanly and never leaves an account without a budget (ADR-0012).
          after: async user => {
            try {
              await insertBudgetWithOwner(db, user.id, { name: "My Budget" });
            } catch (error) {
              await db
                .delete(schema.user)
                .where(eq(schema.user.id, user.id))
                .catch(() => undefined);
              throw error;
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
