#!/bin/sh
# Runs once, on first start of an empty database volume (ADR-0014). Creates three roles:
#   kash_migrator  owns the schema and runs migrations
#   kash_app       the running app: SELECT/INSERT/UPDATE/DELETE only, no DDL, not a superuser
#   kash_jobs      pg-boss, confined to its own schema
# The POSTGRES_USER account stays for administration (backups).
set -e
: "${KASH_MIGRATOR_DB_PASSWORD:=$POSTGRES_PASSWORD}"
: "${KASH_APP_DB_PASSWORD:=$POSTGRES_PASSWORD}"
: "${KASH_JOBS_DB_PASSWORD:=$POSTGRES_PASSWORD}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v mig="$KASH_MIGRATOR_DB_PASSWORD" -v app="$KASH_APP_DB_PASSWORD" -v jobs="$KASH_JOBS_DB_PASSWORD" <<'SQL'
CREATE ROLE kash_migrator LOGIN PASSWORD :'mig' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE ROLE kash_app LOGIN PASSWORD :'app' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE ROLE kash_jobs LOGIN PASSWORD :'jobs' NOSUPERUSER NOCREATEROLE NOCREATEDB;
ALTER SCHEMA public OWNER TO kash_migrator;
REVOKE ALL ON DATABASE kash FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE kash TO kash_app, kash_jobs;
GRANT CONNECT, CREATE ON DATABASE kash TO kash_migrator;
GRANT USAGE ON SCHEMA public TO kash_app;
CREATE SCHEMA pgboss AUTHORIZATION kash_jobs;
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;
SQL
