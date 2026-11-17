import { isIP } from "node:net";

/** Parse an IPv6 literal (no brackets, no zone) into 16 bytes, or null. */
function parseV6(input: string): number[] | null {
  let s = input;
  const bytes: number[] = [];
  // Embedded dotted IPv4 tail (::ffff:1.2.3.4).
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  let tail: number[] = [];
  if (m) {
    const v4 = parseV4(m[2]!);
    if (!v4) return null;
    tail = v4;
    s = `${m[1]!}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toWords = (p: string) => (p === "" ? [] : p.split(":"));
  const head = toWords(halves[0]!);
  const rest = halves.length === 2 ? toWords(halves[1]!) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - rest.length;
  if (fill < (halves.length === 2 ? 1 : 0)) return null;
  const words = [...head, ...Array<string>(fill).fill("0"), ...rest];
  for (const w of words) {
    if (!/^[0-9a-f]{1,4}$/i.test(w)) return null;
    const n = parseInt(w, 16);
    bytes.push(n >> 8, n & 255);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes.length === 16 ? bytes : null;
}

function parseV4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function blockedV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  );
}

/**
 * True when the address must never be contacted: loopback, link-local, private,
 * CGNAT, metadata, multicast, reserved, unspecified, and IPv6 forms that embed
 * such IPv4 addresses (mapped, NAT64, 6to4). Unparseable input is blocked.
 */
export function isBlockedAddress(raw: string): boolean {
  const host = raw.replace(/^\[|\]$/g, "").split("%")[0]!;
  const kind = isIP(host);
  if (kind === 4) return blockedV4(parseV4(host)!);
  if (kind !== 6) return true;
  const b = parseV6(host);
  if (!b) return true;
  const allZero = (from: number, to: number) =>
    b.slice(from, to).every(x => x === 0);
  if (allZero(0, 15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (allZero(0, 10) && b[10] === 255 && b[11] === 255)
    return blockedV4(b.slice(12)); // ::ffff:a.b.c.d
  if (allZero(0, 12)) return true; // deprecated IPv4-compatible
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b)
    return blockedV4(b.slice(12)); // 64:ff9b::/96 NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(b.slice(2, 6)); // 6to4
  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // fe80::/10
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8)
    return true; // documentation
  return false;
}
