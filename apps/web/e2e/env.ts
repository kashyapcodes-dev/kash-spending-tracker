import { tmpdir } from "node:os";
import { join } from "node:path";

export const PORT = 3100;
export const CLOSED_PORT = 3101;
export const VERIFY_PORT = 3102;
export const E2E_DB_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://kash:kash@localhost:54329/kash_e2e";
export const MAIL_FILE = join(tmpdir(), "kash-e2e-mail.jsonl");
