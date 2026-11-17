import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, ENV_VARIABLES, loadConfig } from "./index";

const valid = {
  DATABASE_URL: "postgres://kash:pw@db:5432/kash",
  AUTH_SECRET: "x".repeat(40),
};

describe("M2-U-1 environment schema", () => {
  it("applies defaults", () => {
    const c = loadConfig(valid);
    expect(c).toMatchObject({
      APP_URL: "http://localhost:3000",
      AUTO_MIGRATE: true,
      SIGNUP_MODE: "open",
      LOG_LEVEL: "info",
      emailConfigured: false,
      KASH_DISABLE_AUTH_RATE_LIMIT: false,
    });
  });

  it.each(["DATABASE_URL", "AUTH_SECRET"])(
    "a missing %s names the variable",
    name => {
      const env: Record<string, string | undefined> = { ...valid };
      delete env[name];
      expect(() => loadConfig(env)).toThrow(new RegExp(`${name}: is required`));
      try {
        loadConfig(env);
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
      }
    },
  );

  it("names every missing variable at once", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*AUTH_SECRET/);
  });

  it("rejects malformed values", () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => loadConfig({ ...valid, APP_URL: "not a url" })).toThrow(
      /APP_URL/,
    );
    expect(() => loadConfig({ ...valid, SIGNUP_MODE: "maybe" })).toThrow(
      /SIGNUP_MODE/,
    );
    expect(() => loadConfig({ ...valid, SMTP_PORT: "99999" })).toThrow(
      /SMTP_PORT/,
    );
    expect(() => loadConfig({ ...valid, AUTO_MIGRATE: "yes" })).toThrow(
      /AUTO_MIGRATE/,
    );
  });

  it("refuses the placeholder and short secrets", () => {
    expect(() =>
      loadConfig({
        ...valid,
        AUTH_SECRET: "replace-me-with-openssl-rand-base64-32",
      }),
    ).toThrow(/AUTH_SECRET: is still the placeholder/);
    expect(() => loadConfig({ ...valid, AUTH_SECRET: "short" })).toThrow(
      /AUTH_SECRET: must be at least 32/,
    );
  });

  it("treats empty optional values as unset and parses booleans and numbers", () => {
    const c = loadConfig({
      ...valid,
      SMTP_HOST: "",
      AUTO_MIGRATE: "false",
      SIGNUP_MODE: "closed",
    });
    expect(c.SMTP_HOST).toBeUndefined();
    expect(c.AUTO_MIGRATE).toBe(false);
    expect(c.SIGNUP_MODE).toBe("closed");
    const m = loadConfig({
      ...valid,
      SMTP_HOST: "mail",
      SMTP_PORT: "2525",
      SMTP_FROM: "kash@example.test",
    });
    expect(m).toMatchObject({ SMTP_PORT: 2525, emailConfigured: true });
    expect(() => loadConfig({ ...valid, SMTP_HOST: "mail" })).toThrow(
      /SMTP_FROM: is required/,
    );
  });

  it("lists the variables the app reads", () => {
    expect(ENV_VARIABLES).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "APP_URL",
        "AUTH_SECRET",
        "AUTO_MIGRATE",
        "SIGNUP_MODE",
        "LOG_LEVEL",
      ]),
    );
  });
});

describe("M2-U-3 process.env is read only by the configuration entry points", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  // The two places that hand `process.env` to `loadConfig`, plus tooling and tests.
  const allowed = [
    "packages/core/src/config/",
    "apps/web/src/server/env.ts",
    // Edge runtime cannot load the config module; reads APP_URL only to decide whether to send HSTS.
    "apps/web/src/middleware.ts",
    "apps/web/src/instrumentation.ts", // reads NEXT_RUNTIME only (Next-provided, not instance config)
    "packages/db/src/migrate-cli.ts",
    "packages/db/drizzle.config.ts",
    "tools/",
    "apps/web/test/",
    "apps/web/e2e/",
    "apps/web/playwright",
    "apps/web/e2e-docker/",
    "apps/web/scripts/", // build-time scripts
    // Reads only NODE_ENV, which Next inlines at build time; it is not instance configuration.
    "apps/web/src/components/pwa-provider.tsx",
    "apps/mcp/src/bin.ts",
    "packages/config/",
    "docker/",
  ];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      if (
        ["node_modules", ".next", ".turbo", "dist", ".git", "drizzle"].includes(
          name,
        )
      )
        return [];
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  it("finds no other reads", () => {
    const offenders = ["apps", "packages", "tools"]
      .flatMap(d => walk(join(root, d)))
      .filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f))
      .map(f => relative(root, f))
      .filter(f => !allowed.some(a => f.startsWith(a)))
      .filter(f => /process\.env/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
