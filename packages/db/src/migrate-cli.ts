import { migrationsFolder, runMigrations } from "./migrate";

// Usage: migrate-cli [migrations-folder]. The folder argument is how the container image
// points at the migrations it ships; from the repo it defaults to packages/db/drizzle.
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (!process.env.DATABASE_MIGRATION_URL)
  console.warn(
    "DATABASE_MIGRATION_URL is not set: migrating as the app role. Use a separate schema-owner role (ADR-0014).",
  );
await runMigrations(url, process.argv[2] ?? migrationsFolder);
console.log("migrations applied");
