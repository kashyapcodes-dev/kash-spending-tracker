import { BlockList, isIP } from "node:net";

/**
 * Client identity behind a proxy (ADR-0013).
 *
 * `none` (default): forwarding headers are ignored. `loopback`, or a CIDR list: the app
 * runs behind a proxy in that set, and `X-Forwarded-For` is read right to left, skipping
 * entries inside the trusted set. The first entry outside it is the client. Entries to the
 * left of that point are client-controlled and never used.
 *
 * Next.js route handlers cannot see the socket peer, so the operator's statement that
 * traffic arrives only through the trusted proxy stands in for the peer check.
 */
export type TrustedProxy = { kind: "none" } | { kind: "list"; list: BlockList };

export function parseTrustedProxy(setting: string | undefined): TrustedProxy {
  const value = (setting ?? "none").trim().toLowerCase();
  if (value === "" || value === "none") return { kind: "none" };
  const list = new BlockList();
  const entries =
    value === "loopback"
      ? ["127.0.0.0/8", "::1/128"]
      : value.split(",").map(s => s.trim());
  for (const e of entries) {
    const [addr = "", bits] = e.split("/");
    const v = isIP(addr);
    if (!v) throw new Error(`TRUSTED_PROXY: invalid address "${e}"`);
    const max = v === 4 ? 32 : 128;
    const n = bits === undefined ? max : Number(bits);
    if (!Number.isInteger(n) || n < 0 || n > max)
      throw new Error(`TRUSTED_PROXY: invalid prefix in "${e}"`);
    list.addSubnet(addr, n, v === 4 ? "ipv4" : "ipv6");
  }
  return { kind: "list", list };
}

const norm = (raw: string): string => {
  let s = raw.trim();
  if (s.startsWith("[")) s = s.slice(1, s.indexOf("]"));
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.split(":")[0]!;
  return s.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
};

const inList = (list: BlockList, ip: string) =>
  list.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");

/** The key used for per-client limits; "unknown" when nothing trustworthy is available. */
export function clientIp(
  headers: { get(name: string): string | null },
  trust: TrustedProxy,
): string {
  if (trust.kind === "none") return "unknown";
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(norm)
    .filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    const ip = chain[i]!;
    if (!isIP(ip)) return "unknown"; // garbage from the proxy side: do not guess
    if (!inList(trust.list, ip)) return ip;
  }
  const real = norm(headers.get("x-real-ip") ?? "");
  return isIP(real) && !inList(trust.list, real) ? real : "unknown";
}
