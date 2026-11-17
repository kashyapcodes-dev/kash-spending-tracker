CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- HAND-WRITTEN (M9): rename duplicate live token names so the unique index can be created.
UPDATE "api_tokens" SET "name" = "name" || ' (' || left("id"::text, 8) || ')'
WHERE "revoked_at" IS NULL AND "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "user_id", "name" ORDER BY "created_at") AS rn
    FROM "api_tokens" WHERE "revoked_at" IS NULL
  ) d WHERE d.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_user_name_live_uq" ON "api_tokens" USING btree ("user_id","name") WHERE "api_tokens"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_budget_id_id_uq" UNIQUE("budget_id","id");--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_budget_id_id_uq" UNIQUE("budget_id","id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_budget_id_id_uq" UNIQUE("budget_id","id");--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_budget_id_id_uq" UNIQUE("budget_id","id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_budget_id_id_uq" UNIQUE("budget_id","id");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_expiry_after_creation" CHECK ("api_tokens"."expires_at" is null or "api_tokens"."expires_at" > "api_tokens"."created_at");--> statement-breakpoint
-- HAND-WRITTEN (M9, ADR-0014): refuse to migrate if any row already crosses budgets, naming the table.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "transactions" c JOIN "categories" p ON p."id" = c."category_id" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table transactions column category_id references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "transactions" c JOIN "bank_accounts" p ON p."id" = c."bank_account_id" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table transactions column bank_account_id references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "staged_transactions" c JOIN "categories" p ON p."id" = c."suggested_category_id" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table staged_transactions column suggested_category_id references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "staged_transactions" c JOIN "transactions" p ON p."id" = c."duplicate_of" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table staged_transactions column duplicate_of references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "staged_transactions" c JOIN "transactions" p ON p."id" = c."transaction_id" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table staged_transactions column transaction_id references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "staged_transactions" c JOIN "bank_accounts" p ON p."id" = c."bank_account_id" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table staged_transactions column bank_account_id references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "staged_transactions" c JOIN "import_batches" p ON p."id" = c."batch_id" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table staged_transactions column batch_id references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "category_targets" c JOIN "categories" p ON p."id" = c."category_id" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table category_targets column category_id references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "agent_proposals" c JOIN "ai_conversations" p ON p."id" = c."conversation_id" WHERE p."budget_id" <> c."budget_id") THEN
    RAISE EXCEPTION 'M9 migration: table agent_proposals column conversation_id references a row of another budget; fix the data first';
  END IF;
END $$;--> statement-breakpoint
-- HAND-WRITTEN (M9, ADR-0014): composite foreign keys (budget_id, x_id). SET NULL clears only x_id (Postgres 15+).
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_budget_fk" FOREIGN KEY ("budget_id", "category_id") REFERENCES "categories" ("budget_id", "id") ON DELETE SET NULL ("category_id");--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_budget_fk" FOREIGN KEY ("budget_id", "bank_account_id") REFERENCES "bank_accounts" ("budget_id", "id") ON DELETE SET NULL ("bank_account_id");--> statement-breakpoint
ALTER TABLE "staged_transactions" DROP CONSTRAINT "staged_transactions_suggested_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_suggested_category_id_budget_fk" FOREIGN KEY ("budget_id", "suggested_category_id") REFERENCES "categories" ("budget_id", "id") ON DELETE SET NULL ("suggested_category_id");--> statement-breakpoint
ALTER TABLE "staged_transactions" DROP CONSTRAINT "staged_transactions_duplicate_of_transactions_id_fk";--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_duplicate_of_budget_fk" FOREIGN KEY ("budget_id", "duplicate_of") REFERENCES "transactions" ("budget_id", "id") ON DELETE SET NULL ("duplicate_of");--> statement-breakpoint
ALTER TABLE "staged_transactions" DROP CONSTRAINT "staged_transactions_transaction_id_transactions_id_fk";--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_transaction_id_budget_fk" FOREIGN KEY ("budget_id", "transaction_id") REFERENCES "transactions" ("budget_id", "id") ON DELETE SET NULL ("transaction_id");--> statement-breakpoint
ALTER TABLE "staged_transactions" DROP CONSTRAINT "staged_transactions_bank_account_id_bank_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_bank_account_id_budget_fk" FOREIGN KEY ("budget_id", "bank_account_id") REFERENCES "bank_accounts" ("budget_id", "id") ON DELETE SET NULL ("bank_account_id");--> statement-breakpoint
ALTER TABLE "staged_transactions" DROP CONSTRAINT "staged_transactions_batch_id_import_batches_id_fk";--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_batch_id_budget_fk" FOREIGN KEY ("budget_id", "batch_id") REFERENCES "import_batches" ("budget_id", "id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "category_targets" DROP CONSTRAINT "category_targets_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "category_targets" ADD CONSTRAINT "category_targets_category_id_budget_fk" FOREIGN KEY ("budget_id", "category_id") REFERENCES "categories" ("budget_id", "id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_proposals" DROP CONSTRAINT "agent_proposals_conversation_id_ai_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_conversation_id_budget_fk" FOREIGN KEY ("budget_id", "conversation_id") REFERENCES "ai_conversations" ("budget_id", "id") ON DELETE SET NULL ("conversation_id");--> statement-breakpoint
-- HAND-WRITTEN (M9, ADR-0014): least privilege. Roles are created by the compose init script (or by the
-- operator, see docs/self-hosting.md); this only grants when kash_app exists, so managed databases still migrate.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kash_app') THEN
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM kash_app';
    EXECUTE 'GRANT USAGE ON SCHEMA public TO kash_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kash_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kash_app';
    -- Future tables created by whoever runs migrations get the same rights.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kash_app', current_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kash_app', current_user);
  ELSE
    RAISE NOTICE 'role kash_app does not exist; skipping grants (see docs/self-hosting.md)';
  END IF;
END $$;
