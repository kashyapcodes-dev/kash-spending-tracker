import { Client } from "pg";
import { runMigrations } from "@kash/db/migrate";

export const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgres://kash:kash@localhost:54329/postgres";
export const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://kash:kash@localhost:54329/kash_test";

/** Recreate the test database and apply the committed migrations once per run. */
export default async function setup() {
  const admin = new Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(
      `Cannot reach Postgres for API tests (${ADMIN_URL}). Start it with: docker compose -f docker/compose.dev.yml up -d --wait\n${String(e)}`,
    );
  }
  // M9: the suite runs as the least-privileged app role (M9-AZ-5, M9-D-3). Roles are per
  // cluster, so create it once; the migration grants it rights on every table.
  await admin.query(`do $$ begin
    if not exists (select from pg_roles where rolname = 'kash_app') then
      create role kash_app login password 'kash_app' nosuperuser nocreaterole nocreatedb;
    end if;
  end $$`);
  await admin.query("drop database if exists kash_test with (force)");
  await admin.query("create database kash_test");
  await admin.end();
  // Migrate as the owner; the tests themselves connect as kash_app (see test/env.ts).
  await runMigrations(TEST_URL);
}
