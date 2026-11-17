import { describe, expect, it } from "vitest";
import {
  createGuardedFetch,
  GuardError,
  type TransportRequest,
} from "./guarded-fetch";
import { isBlockedAddress } from "./ip";
import { simplefinProvider } from "../bank/simplefin";

const PUBLIC = "93.184.216.34";

function setup(
  resolve: (h: string) => Promise<string[]> = async () => [PUBLIC],
) {
  const seen: TransportRequest[] = [];
  const f = createGuardedFetch({
    allowedHosts: ["bridge.example"],
    resolve,
    transport: async r => {
      seen.push(r);
      return { status: 200, body: Buffer.from("ok") };
    },
  });
  return { f, seen };
}

describe("M9-U-1 guarded fetch refuses", () => {
  const urls = [
    "http://bridge.example/x",
    "https://u:p@bridge.example/x",
    "https://bridge.example:8443/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://169.254.169.254/latest",
    "https://10.1.2.3/x",
    "https://172.16.0.1/x",
    "https://192.168.1.1/x",
    "https://100.64.0.1/x",
    "https://[::ffff:127.0.0.1]/x",
    "https://[::ffff:7f00:1]/x",
    "https://2130706433/x",
    "https://0x7f000001/x",
    "https://0177.0.0.1/x",
  ];
  it.each(urls)("%s", async u => {
    const { f, seen } = setup();
    await expect(f(u)).rejects.toBeInstanceOf(GuardError);
    expect(seen).toHaveLength(0);
  });

  it("a hostname that resolves to a private address", async () => {
    const { f, seen } = setup(async () => ["10.0.0.5"]);
    await expect(f("https://bridge.example/x")).rejects.toMatchObject({
      code: "blocked_address",
    });
    expect(seen).toHaveLength(0);
  });

  it("a mixed public and private answer", async () => {
    const { f } = setup(async () => [PUBLIC, "127.0.0.1"]);
    await expect(f("https://bridge.example/x")).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it.each([
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "ff02::1",
    "0.0.0.0",
    "224.0.0.1",
    "not an ip",
  ])("isBlockedAddress(%s)", a => expect(isBlockedAddress(a)).toBe(true));

  it.each([PUBLIC, "2606:4700:4700::1111", "::ffff:5db8:d822"])(
    "isBlockedAddress allows %s",
    a => expect(isBlockedAddress(a)).toBe(false),
  );
});

describe("M9-U-2 guarded fetch connection rules", () => {
  it("connects to the address it checked, resolving once", async () => {
    let calls = 0;
    const { f, seen } = setup(async () =>
      ++calls === 1 ? [PUBLIC] : ["127.0.0.1"],
    );
    await f("https://bridge.example/x");
    expect(calls).toBe(1);
    expect(seen[0]!.address).toBe(PUBLIC);
  });

  it("treats a redirect as an error", async () => {
    const f = createGuardedFetch({
      allowedHosts: ["bridge.example", "other.example"],
      resolve: async () => [PUBLIC],
      transport: async () => ({ status: 302, body: Buffer.alloc(0) }),
    });
    await expect(f("https://bridge.example/x")).rejects.toMatchObject({
      code: "redirect",
    });
  });
});

describe("M9-U-3 / M9-U-4 / M9-U-18 SimpleFIN completeLink", () => {
  const token = (u: string) => Buffer.from(u).toString("base64");

  it("sends nothing for a token pointing at a local server", async () => {
    let hits = 0;
    const p = simplefinProvider({
      fetch: async () => {
        hits++;
        return new Response("x");
      },
    });
    for (const u of [
      "https://127.0.0.1/claim",
      "http://beta-bridge.simplefin.org/claim",
      "https://localhost/claim/x",
      "https://evil.example/claim",
    ])
      await expect(p.completeLink({ setupToken: token(u) })).rejects.toThrow(
        "not valid",
      );
    expect(hits).toBe(0);
  });

  it("accepts the allowed host and returns the access URL", async () => {
    const p = simplefinProvider({
      allowedHosts: ["bridge.example"],
      fetch: async () => new Response("https://u:p@bridge.example/simplefin"),
    });
    await expect(
      p.completeLink({ setupToken: token("https://bridge.example/claim/1") }),
    ).resolves.toEqual({ secret: "https://u:p@bridge.example/simplefin" });
  });

  it("rejects an access URL on a different host than the claim URL", async () => {
    const p = simplefinProvider({
      allowedHosts: ["bridge.example", "other.example"],
      fetch: async () => new Response("https://u:p@other.example/simplefin"),
    });
    await expect(
      p.completeLink({ setupToken: token("https://bridge.example/claim/1") }),
    ).rejects.toThrow("unusable access URL");
  });

  it("errors carry no response body or status text", async () => {
    const p = simplefinProvider({
      allowedHosts: ["bridge.example"],
      fetch: async () =>
        new Response("secret-body-123", {
          status: 500,
          statusText: "Boom-Text",
        }),
    });
    const e = await p
      .completeLink({ setupToken: token("https://bridge.example/c") })
      .catch((x: unknown) => x as Error);
    expect(String((e as Error).message)).not.toMatch(/secret-body|Boom|500/);
  });

  it("never leaks userinfo in errors", async () => {
    const p = simplefinProvider({
      allowedHosts: ["bridge.example"],
      fetch: async () => {
        throw new Error("boom https://user:pass@bridge.example");
      },
    });
    const e = await p
      .sync("https://user:pass@bridge.example/simplefin", null, "2026-01-01")
      .catch((x: unknown) => x as Error);
    expect(String((e as Error).message)).not.toMatch(/user|pass/);
    const bad = await p
      .sync("https://user:pass@evil.example/simplefin", null, "2026-01-01")
      .catch((x: unknown) => x as Error);
    expect(String((bad as Error).message)).not.toMatch(/user|pass|evil/);
  });
});
