import {
  ProviderError,
  toCents,
  type BankSyncProvider,
  type ProviderTransaction,
} from "./types";

import { checkUrl, createGuardedFetch, GuardError } from "../net/guarded-fetch";

export const DEFAULT_SIMPLEFIN_HOSTS = ["beta-bridge.simplefin.org"];

/** Parse SIMPLEFIN_ALLOWED_HOSTS (comma separated) on top of the default host. */
export function simplefinAllowedHosts(extra: string | undefined): string[] {
  const more = (extra ?? "")
    .split(",")
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_SIMPLEFIN_HOSTS, ...more])];
}

const DAY = 86_400;
const MAX_WINDOW_DAYS = 90;

interface SfAccount {
  id: string;
  name: string;
  transactions?: {
    id: string;
    posted: number;
    amount: string;
    description: string;
    pending?: boolean;
  }[];
}

/** SimpleFIN: positive amounts are deposits (income), negative are withdrawals (expense). */
export function mapSimplefinTransaction(
  accountId: string,
  t: NonNullable<SfAccount["transactions"]>[number],
  fallbackDate: string,
): ProviderTransaction {
  const amount = Number(t.amount);
  return {
    externalId: `${accountId}:${t.id}`,
    accountExternalId: accountId,
    date:
      t.posted > 0
        ? new Date(t.posted * 1000).toISOString().slice(0, 10)
        : fallbackDate,
    name: t.description.trim() || "Unknown",
    amountCents: toCents(t.amount),
    type: amount < 0 ? "expense" : "income",
    pending: t.pending === true,
  };
}

/**
 * Basic auth comes from the URL's userinfo (by SimpleFIN's design); the guarded fetch
 * takes plain URLs. The host must be allowlisted; credentials never appear in errors.
 */
function split(
  accessUrl: string,
  allowedHosts: readonly string[],
): { url: string; auth: string } {
  let u: URL;
  try {
    u = checkUrl(accessUrl, allowedHosts, true);
  } catch {
    throw new ProviderError("auth", "SimpleFIN access is not valid; reconnect");
  }
  const auth = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}`;
  u.username = "";
  u.password = "";
  return { url: u.toString().replace(/\/$/, ""), auth };
}

export function simplefinProvider(
  o: {
    fetch?: typeof fetch;
    now?: () => number;
    allowedHosts?: readonly string[];
  } = {},
): BankSyncProvider {
  const allowedHosts = o.allowedHosts ?? DEFAULT_SIMPLEFIN_HOSTS;
  const doFetch = o.fetch ?? createGuardedFetch({ allowedHosts });
  const now = o.now ?? (() => Date.now());

  async function accounts(secret: string, start?: number, end?: number) {
    const { url, auth } = split(secret, allowedHosts);
    const q = new URLSearchParams({ version: "2", pending: "1" });
    if (start !== undefined) q.set("start-date", String(start));
    if (end !== undefined) q.set("end-date", String(end));
    let res: Response;
    try {
      res = await doFetch(`${url}/accounts?${q}`, {
        headers: { authorization: auth },
      });
    } catch {
      throw new ProviderError("transient", "Could not reach SimpleFIN");
    }
    if (res.status === 403 || res.status === 402)
      throw new ProviderError(
        "auth",
        "SimpleFIN access was refused; reconnect",
      );
    if (!res.ok)
      throw new ProviderError(
        "transient",
        "SimpleFIN is unavailable; try again later",
      );
    const json = (await res.json()) as {
      accounts: SfAccount[];
      errlist?: { code: string }[];
    };
    if (
      json.errlist?.some(
        e => e.code.startsWith("con.auth") || e.code.startsWith("gen.auth"),
      )
    )
      throw new ProviderError(
        "auth",
        "SimpleFIN reports an authentication problem; reconnect",
      );
    return json.accounts;
  }

  return {
    id: "simplefin",
    isConfigured: () => true,
    async startLink() {
      return {
        instructions:
          "Create a setup token in your SimpleFIN Bridge account and paste it here. It works once.",
      };
    },
    async completeLink({ setupToken }) {
      if (!setupToken) throw new ProviderError("auth", "Missing setup token");
      let claimUrl: URL;
      try {
        claimUrl = checkUrl(
          Buffer.from(setupToken.trim(), "base64").toString("utf8"),
          allowedHosts,
        );
      } catch {
        // Nothing is sent: the token decodes to a URL we refuse to contact.
        throw new ProviderError("auth", "That setup token is not valid");
      }
      let res: Response;
      try {
        res = await doFetch(claimUrl.href, {
          method: "POST",
          headers: { "content-length": "0" },
        });
      } catch (e) {
        if (e instanceof GuardError && e.code === "redirect")
          throw new ProviderError("auth", "That setup token is not valid");
        throw new ProviderError("transient", "Could not reach SimpleFIN");
      }
      if (res.status === 403)
        throw new ProviderError(
          "auth",
          "Setup token unknown or already used; make a new one",
        );
      if (!res.ok)
        throw new ProviderError(
          "transient",
          "SimpleFIN is unavailable; try again later",
        );
      const secret = (await res.text()).trim();
      let access: URL;
      try {
        access = checkUrl(secret, allowedHosts, true);
      } catch {
        throw new ProviderError(
          "auth",
          "SimpleFIN returned an unusable access URL",
        );
      }
      // The access URL must stay on the host the claim used.
      if (access.host !== claimUrl.host)
        throw new ProviderError(
          "auth",
          "SimpleFIN returned an unusable access URL",
        );
      return { secret };
    },
    async listAccounts(secret) {
      const { url, auth } = split(secret, allowedHosts);
      const res = await doFetch(`${url}/accounts?version=2&balances-only=1`, {
        headers: { authorization: auth },
      });
      if (res.status === 403)
        throw new ProviderError(
          "auth",
          "SimpleFIN access was refused; reconnect",
        );
      if (!res.ok)
        throw new ProviderError(
          "transient",
          "SimpleFIN is unavailable; try again later",
        );
      const json = (await res.json()) as { accounts: SfAccount[] };
      return json.accounts.map(a => ({
        externalId: a.id,
        name: a.name,
        mask: null,
        type: null,
      }));
    },
    /** No cursor: windows of at most 90 days from `since`, de-duplicated by external id upstream. */
    async sync(secret, _cursor, since) {
      const added: ProviderTransaction[] = [];
      let start = Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000);
      const end = Math.floor(now() / 1000) + DAY;
      while (start < end) {
        const stop = Math.min(start + MAX_WINDOW_DAYS * DAY, end);
        for (const a of await accounts(secret, start, stop))
          for (const t of a.transactions ?? [])
            added.push(mapSimplefinTransaction(a.id, t, since));
        start = stop;
      }
      return { added, modified: [], removedIds: [], nextCursor: null };
    },
    async disconnect() {
      // SimpleFIN has no revoke call; the user removes the app token in their Bridge account.
    },
  };
}
