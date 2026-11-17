import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SKIP = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  ".git",
  "drizzle",
  "test-results",
]);
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (SKIP.has(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/**
 * M9-U-12: an outbound `fetch(` from the server is a place user input could steer. Every one
 * must be listed here with the reason it is safe.
 */
const ALLOWED: [string, string][] = [
  ["packages/integrations/src/net/", "the guarded fetch itself"],
  [
    "packages/integrations/src/ai/",
    "AI providers: fixed hosts, or the operator's OLLAMA_BASE_URL",
  ],
  [
    "packages/integrations/src/bank/plaid.ts",
    "fixed host (plaid.com), no user-supplied URL",
  ],
  [
    "apps/web/src/app/api/v1/webhooks/plaid/route.ts",
    "fixed host (plaid.com), key id validated first",
  ],
  ["apps/mcp/src/", "calls the operator's own KASH_URL"],
  ["apps/web/src/lib/", "browser code, same origin"],
  ["apps/web/src/sw/", "service worker, same origin"],
  ["apps/web/src/components/", "browser code, same origin"],
  ["apps/web/e2e", "tests"],
  ["apps/web/test/", "tests"],
  ["tools/", "developer tooling"],
  ["packages/api-client/", "typed client; the caller supplies the base URL"],
  ["docker/", "container checks"],
];

describe("M9-U-12 no outbound fetch outside the guarded fetch", () => {
  it("lists every fetch( call site and finds none unexplained", () => {
    const found: string[] = [];
    for (const f of walk(root)) {
      if (!/\.(ts|tsx|mjs)$/.test(f)) continue;
      const rel = relative(root, f);
      if (/\.test\.tsx?$/.test(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (
        /(?<![\w.])fetch\(/.test(src) &&
        !ALLOWED.some(([p]) => rel.startsWith(p))
      )
        found.push(rel);
    }
    expect(found).toEqual([]);
  });
});
