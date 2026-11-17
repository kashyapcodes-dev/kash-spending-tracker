import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationsFolder, runMigrations } from "./migrate";

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgres://kash:kash@localhost:54329/postgres";
const at = (db: string, user?: string) => {
  const u = new URL(ADMIN);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = user;
  }
  return u.toString();
};
const DB = "kash_db_sec";
let c: Client; // owner connection
let app: Client; // kash_app connection

async function freshDb(name: string) {
  const admin = new Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.query(`do $$ begin
    if not exists (select from pg_roles where rolname = 'kash_app') then
      create role kash_app login password 'kash_app' nosuperuser nocreaterole nocreatedb;
    end if; end $$`);
  await admin.end();
}

beforeAll(async () => {
  await freshDb(DB);
  await runMigrations(at(DB));
  c = new Client({ connectionString: at(DB) });
  await c.connect();
  app = new Client({ connectionString: at(DB, "kash_app") });
  await app.connect();
});
afterAll(async () => {
  await c.end();
  await app.end();
});

let n = 0;
async function seedBudget() {
  const uid = `u${++n}-${Date.now()}`;
  await c.query(`insert into "user"(id,name,email) values ($1,'U',$2)`, [
    uid,
    `${uid}@x.test`,
  ]);
  const b = (
    await c.query(
      `insert into budgets(name, created_by) values ('Budget',$1) returning id`,
      [uid],
    )
  ).rows[0].id as string;
  const q = async (sql: string, p: unknown[] = []) =>
    (await c.query(sql, p)).rows[0].id as string;
  const category = await q(
    `insert into categories(budget_id,name) values ($1,'Cat'||gen_random_uuid()) returning id`,
    [b],
  );
  const tx = await q(
    `insert into transactions(budget_id,type,name,amount_cents,date) values ($1,'expense','x',1,'2026-01-01') returning id`,
    [b],
  );
  const conn = await q(
    `insert into bank_connections(budget_id,provider,secret_encrypted) values ($1,'plaid','x') returning id`,
    [b],
  );
  const account = await q(
    `insert into bank_accounts(connection_id,budget_id,external_id,name) values ($1,$2,'e','n') returning id`,
    [conn, b],
  );
  const batch = await q(
    `insert into import_batches(budget_id,source,label) values ($1,'csv','l') returning id`,
    [b],
  );
  const conv = await q(
    `insert into ai_conversations(budget_id,user_id) values ($1,$2) returning id`,
    [b, uid],
  );
  return { uid, b, category, tx, account, batch, conv };
}

describe("M9-D-1 composite foreign keys refuse cross-budget references", () => {
  it.each([
    [
      "transactions.category_id",
      "insert into transactions(budget_id,type,name,amount_cents,date,category_id) values ($1,'expense','x',1,'2026-01-01',$2)",
      "category",
    ],
    [
      "transactions.bank_account_id",
      "insert into transactions(budget_id,type,name,amount_cents,date,bank_account_id) values ($1,'expense','x',1,'2026-01-01',$2)",
      "account",
    ],
    [
      "staged.suggested_category_id",
      "insert into staged_transactions(budget_id,batch_id,source,type,name,amount_cents,date,suggested_category_id) values ($1,(select id from import_batches where budget_id=$1 limit 1),'csv','expense','x',1,'2026-01-01',$2)",
      "category",
    ],
    [
      "staged.duplicate_of",
      "insert into staged_transactions(budget_id,batch_id,source,type,name,amount_cents,date,duplicate_of) values ($1,(select id from import_batches where budget_id=$1 limit 1),'csv','expense','x',1,'2026-01-01',$2)",
      "tx",
    ],
    [
      "staged.transaction_id",
      "insert into staged_transactions(budget_id,batch_id,source,type,name,amount_cents,date,transaction_id) values ($1,(select id from import_batches where budget_id=$1 limit 1),'csv','expense','x',1,'2026-01-01',$2)",
      "tx",
    ],
    [
      "staged.bank_account_id",
      "insert into staged_transactions(budget_id,batch_id,source,type,name,amount_cents,date,bank_account_id) values ($1,(select id from import_batches where budget_id=$1 limit 1),'csv','expense','x',1,'2026-01-01',$2)",
      "account",
    ],
    [
      "staged.batch_id",
      "insert into staged_transactions(budget_id,batch_id,source,type,name,amount_cents,date) values ($1,$2,'csv','expense','x',1,'2026-01-01')",
      "batch",
    ],
    [
      "category_targets.category_id",
      "insert into category_targets(budget_id,category_id,amount_cents) values ($1,$2,5)",
      "category",
    ],
    [
      "agent_proposals.conversation_id",
      "insert into agent_proposals(budget_id,user_id,origin,summary,operations,preview,expires_at,conversation_id) values ($1,(select created_by from budgets where id=$1),'chat','s','[]','{}',now(),$2)",
      "conv",
    ],
  ] as const)("%s", async (_name, sql, key) => {
    const a = await seedBudget();
    const other = await seedBudget();
    // Same budget works (control), the other budget's row is refused by Postgres itself.
    await c.query(sql, [a.b, a[key]]);
    await expect(c.query(sql, [a.b, other[key]])).rejects.toThrow(
      /foreign key|violates/i,
    );
  });
});

describe("M9-D-2 deleting a parent clears only the reference", () => {
  it("category delete nulls category_id and keeps budget_id", async () => {
    const a = await seedBudget();
    const t = (
      await c.query(
        `insert into transactions(budget_id,type,name,amount_cents,date,category_id) values ($1,'expense','x',1,'2026-01-01',$2) returning id`,
        [a.b, a.category],
      )
    ).rows[0].id;
    await c.query(`delete from categories where id=$1`, [a.category]);
    const row = (
      await c.query(
        `select budget_id, category_id from transactions where id=$1`,
        [t],
      )
    ).rows[0];
    expect(row.category_id).toBeNull();
    expect(row.budget_id).toBe(a.b);
  });

  it("budget delete cascades as before", async () => {
    const a = await seedBudget();
    await c.query(`delete from budgets where id=$1`, [a.b]);
    expect(
      (await c.query(`select 1 from transactions where budget_id=$1`, [a.b]))
        .rowCount,
    ).toBe(0);
    expect(
      (await c.query(`select 1 from categories where budget_id=$1`, [a.b]))
        .rowCount,
    ).toBe(0);
  });
});

describe("M9-D-3 the app role is least-privileged", () => {
  it("can read and write rows", async () => {
    const a = await seedBudget();
    await app.query(`update transactions set name='y' where id=$1`, [a.tx]);
    expect(
      (await app.query(`select name from transactions where id=$1`, [a.tx]))
        .rows[0].name,
    ).toBe("y");
    await app.query(`insert into auth_throttle(key,failures) values ($1,1)`, [
      `k${a.uid}`,
    ]);
  });

  it.each([
    "create table evil(x int)",
    "drop table transactions",
    "truncate transactions",
    "alter table transactions add column evil int",
    "alter role kash_app superuser",
    "create role evil",
    "alter table transactions drop constraint transactions_budget_id_id_uq",
  ])("refuses: %s", async stmt => {
    await expect(app.query(stmt)).rejects.toThrow(
      /permission denied|must be owner|must have/i,
    );
  });

  it("is not a superuser", async () => {
    const r = (
      await app.query(
        `select rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user`,
      )
    ).rows[0];
    expect(r).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
  });
});

describe("M9-D-4 migration from 0004", () => {
  const folder = mkdtempSync(join(tmpdir(), "kash-mig-"));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("rolls forward with no data loss and refuses cross-budget rows by name", async () => {
    cpSync(migrationsFolder, folder, { recursive: true });
    // Rebuild a "0004-only" folder.
    const only4 = mkdtempSync(join(tmpdir(), "kash-mig4-"));
    cpSync(folder, only4, { recursive: true });
    const jp = join(only4, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(jp, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= 4,
    );
    writeFileSync(jp, JSON.stringify(journal));

    // Clean data: rolls forward and keeps it.
    await freshDb("kash_db_mig_ok");
    await runMigrations(at("kash_db_mig_ok"), only4);
    const ok = new Client({ connectionString: at("kash_db_mig_ok") });
    await ok.connect();
    await ok.query(
      `insert into "user"(id,name,email) values ('u','U','u@x.test')`,
    );
    const b = (
      await ok.query(
        `insert into budgets(name,created_by) values ('Bravo','u') returning id`,
      )
    ).rows[0].id;
    const cat = (
      await ok.query(
        `insert into categories(budget_id,name) values ($1,'Food') returning id`,
        [b],
      )
    ).rows[0].id;
    await ok.query(
      `insert into transactions(budget_id,type,name,amount_cents,date,category_id) values ($1,'expense','x',5,'2026-01-01',$2)`,
      [b, cat],
    );
    await runMigrations(at("kash_db_mig_ok"));
    expect(
      (await ok.query(`select count(*)::int n from transactions`)).rows[0].n,
    ).toBe(1);
    await ok.end();

    // A cross-budget row (possible only before this migration) makes it fail, naming the table.
    await freshDb("kash_db_mig_bad");
    await runMigrations(at("kash_db_mig_bad"), only4);
    const bad = new Client({ connectionString: at("kash_db_mig_bad") });
    await bad.connect();
    await bad.query(
      `insert into "user"(id,name,email) values ('u','U','u@x.test')`,
    );
    const b1 = (
      await bad.query(
        `insert into budgets(name,created_by) values ('Alpha','u') returning id`,
      )
    ).rows[0].id;
    const b2 = (
      await bad.query(
        `insert into budgets(name,created_by) values ('Bravo','u') returning id`,
      )
    ).rows[0].id;
    const cat2 = (
      await bad.query(
        `insert into categories(budget_id,name) values ($1,'Food') returning id`,
        [b2],
      )
    ).rows[0].id;
    await bad.query(
      `insert into transactions(budget_id,type,name,amount_cents,date,category_id) values ($1,'expense','x',5,'2026-01-01',$2)`,
      [b1, cat2],
    );
    await bad.end();
    await expect(runMigrations(at("kash_db_mig_bad"))).rejects.toThrow(
      /table transactions/,
    );
    rmSync(only4, { recursive: true, force: true });
  });
});
