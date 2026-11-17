#!/bin/bash
# Container acceptance tests M2-D-1 to M2-D-9 (M2-D-10, the arm64 build, runs in CI).
# Usage: docker/test/run.sh            builds the image first
#        KASH_IMAGE=kash:ci SKIP_BUILD=1 docker/test/run.sh
# Needs Docker, curl, openssl and a Playwright Chromium (pnpm --filter @kash/web exec playwright install chromium).
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE="${KASH_IMAGE:-kash:test}"
PORT="${TEST_PORT:-3290}"
PROJECT="kash-dtest"
ENVFILE="$(mktemp)"
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }
compose() { KASH_IMAGE="$IMAGE" APP_PORT="$PORT" docker compose -p "$PROJECT" -f docker/compose.yml --env-file "$ENVFILE" "$@"; }
cleanup() { compose down -v >/dev/null 2>&1 || true; docker rm -f kash-d5a kash-d5b kash-d6 >/dev/null 2>&1 || true; docker rm -f kash-d5db >/dev/null 2>&1 || true; docker network rm kash-d5 >/dev/null 2>&1 || true; rm -f "$ENVFILE"; }
trap cleanup EXIT
is_health() { [ "$(health)" = "$1" ]; }
health() { curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/v1/health" || true; }
wait_for() { # wait_for <seconds> <command...>
  local n=$1; shift; for _ in $(seq 1 "$n"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done; return 1
}

if [ -z "${SKIP_BUILD:-}" ]; then docker build -f docker/Dockerfile -t "$IMAGE" . >/dev/null; fi

# Same steps as the quick start in docs/self-hosting.md (M2-DOC-2), with test ports.
cp docker/.env.example "$ENVFILE"
PW=$(openssl rand -hex 24); SECRET=$(openssl rand -base64 32 | tr -d '\n')
sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PW|; s|^AUTH_SECRET=.*|AUTH_SECRET=$SECRET|; s|^APP_URL=.*|APP_URL=http://localhost:$PORT|" "$ENVFILE"; rm -f "$ENVFILE.bak"

# M2-D-1
start=$(date +%s)
compose up -d --wait --wait-timeout 120 >/dev/null
[ $(( $(date +%s) - start )) -le 120 ] || fail "M2-D-1 took longer than 120s"
pass "M2-D-1 stack healthy"

# M2-D-4 (first half): empty database, migrations applied on boot, health reports db ok.
[ "$(health)" = "200" ] || fail "M2-D-4 health not 200"
curl -s "http://localhost:$PORT/api/v1/health" | grep -q '"db":"ok"' || fail "M2-D-4 db not ok"
# One row per committed migration file, so adding a migration does not break the test.
EXPECTED=$(ls packages/db/drizzle/*.sql | wc -l | tr -d " ")
migrations() { compose exec -T db psql -U kash -d kash -tAc 'select count(*) from drizzle.__drizzle_migrations'; }
[ "$(migrations)" = "$EXPECTED" ] || fail "M2-D-4 expected $EXPECTED applied migrations, got $(migrations)"
pass "M2-D-4a migrations applied on boot"

# M9-D-5: three roles; the app runs as kash_app, the schema belongs to kash_migrator.
psqlk() { compose exec -T db psql -U kash -d kash -tAc "$1"; }
psqlk "select usename from pg_stat_activity where datname='kash' and usename like 'kash\_%' escape '\\'" | grep -q '^kash_app$' || fail "M9-D-5 app is not connected as kash_app"
[ "$(psqlk "select tableowner from pg_tables where tablename='transactions'")" = "kash_migrator" ] || fail "M9-D-5 schema is not owned by kash_migrator"
[ "$(psqlk "select has_schema_privilege('kash_app','public','CREATE')")" = "f" ] || fail "M9-D-5 kash_app can create objects"
[ "$(psqlk "select rolsuper from pg_roles where rolname='kash_app'")" = "f" ] || fail "M9-D-5 kash_app is a superuser"
[ "$(psqlk "select has_table_privilege('kash_app','transactions','TRUNCATE')")" = "f" ] || fail "M9-D-5 kash_app can truncate"
pass "M9-D-5 least-privilege roles"

# M2-D-2
export E2E_BASE_URL="http://localhost:$PORT"
(cd apps/web && pnpm exec playwright test -c playwright.docker.config.ts) || fail "M2-D-2 smoke test"
pass "M2-D-2 smoke test"

# M4: the image ships the PWA files (public/ is not part of Next's standalone output).
for f in sw.js manifest.webmanifest icons/icon-192.png icons/icon-maskable-512.png; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/$f")" = "200" ] || fail "M4 /$f is not served by the image"
done
pass "M4 PWA files served by the image"

# M2-D-8
[ "$(compose exec -T app id -u | tr -d '\r')" != "0" ] || fail "M2-D-8 app runs as root"
compose exec -T app sh -c 'find / -xdev \( -name ".env" -o -name "*.map" \) -not -path "/proc/*" -not -path "*/node_modules/*" 2>/dev/null | grep -q .' && fail "M2-D-8 found .env or source maps" || true
pass "M2-D-8 non-root, no .env or source maps"

# M2-D-9 (backup part)
BACKUPS="$(mktemp -d)"
KASH_IMAGE="$IMAGE" APP_PORT="$PORT" sh -c "COMPOSE_PROJECT_NAME=$PROJECT docker compose -p $PROJECT -f docker/compose.yml --env-file $ENVFILE exec -T db pg_dump -U kash -d kash --format=custom" > "$BACKUPS/kash.dump"
[ -s "$BACKUPS/kash.dump" ] || fail "M2-D-9 empty dump"
# Also exercise the shipped script (it uses the default compose project, so point it at ours).
sed "s|compose=\"docker compose -f docker/compose.yml\"|compose=\"docker compose -p $PROJECT -f docker/compose.yml --env-file $ENVFILE\"|" docker/backup.sh > "$BACKUPS/backup-test.sh"
KASH_IMAGE="$IMAGE" APP_PORT="$PORT" sh "$BACKUPS/backup-test.sh" "$BACKUPS/out" 2 >/dev/null
ls "$BACKUPS"/out/kash-*.dump >/dev/null || fail "M2-D-9 backup.sh wrote nothing"

# M2-D-3: down and up again with the volume kept.
compose down >/dev/null
compose up -d --wait --wait-timeout 120 >/dev/null
[ "$(migrations)" = "$EXPECTED" ] || fail "M2-D-4 a second start applied migrations again"
pass "M2-D-4b second start applies nothing"
(cd apps/web && SMOKE_PHASE=after-restart pnpm exec playwright test -c playwright.docker.config.ts) || fail "M2-D-3 data after restart"
pass "M2-D-3 data survives down/up"

# M2-D-7: stop db -> 503; start db -> 200 without restarting app.
app_started=$(docker inspect -f '{{.State.StartedAt}}' "$(compose ps -q app)")
compose stop db >/dev/null
wait_for 30 is_health 503 || fail "M2-D-7 health did not go 503"
compose start db >/dev/null
wait_for 60 is_health 200 || fail "M2-D-7 health did not recover"
[ "$(docker inspect -f '{{.State.StartedAt}}' "$(compose ps -q app)")" = "$app_started" ] || fail "M2-D-7 app restarted"
pass "M2-D-7 db outage and recovery"

# M2-D-9 (restore part): destroy the volume, restore into a fresh stack.
compose down -v >/dev/null
compose up -d db --wait >/dev/null
compose exec -T db createdb -U kash restore_check >/dev/null
compose exec -T db pg_restore -U kash -d restore_check --no-owner < "$BACKUPS/kash.dump"
rows=$(compose exec -T db psql -U kash -d restore_check -tAc "select (select count(*) from \"user\") || ',' || (select count(*) from transactions)")
[ "$rows" = "1,1" ] || fail "M2-D-9 restored data wrong: $rows"
pass "M2-D-9 backup and restore"
compose down -v >/dev/null

# M2-D-6: placeholder secret -> non-zero exit naming the variable.
docker network create kash-d5 >/dev/null
set +e
out=$(docker run --rm --name kash-d6 -e DATABASE_URL=postgres://x:y@db:5432/kash -e AUTH_SECRET=replace-me-with-openssl-rand-base64-32 "$IMAGE" 2>&1); code=$?
set -e
[ "$code" -ne 0 ] || fail "M2-D-6 container started with the placeholder secret"
echo "$out" | grep -q "AUTH_SECRET" || fail "M2-D-6 log does not name AUTH_SECRET: $out"
set +e; out=$(docker run --rm -e DATABASE_URL=postgres://x:y@db:5432/kash "$IMAGE" 2>&1); code=$?; set -e
[ "$code" -ne 0 ] && echo "$out" | grep -q "AUTH_SECRET: is required" || fail "M2-D-6 unset secret"
pass "M2-D-6 bad configuration refused"

# M2-D-5: two app containers against one empty database.
docker run -d --name kash-d5db --network kash-d5 -e POSTGRES_USER=kash -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=kash postgres:17-alpine >/dev/null
wait_for 60 docker exec kash-d5db pg_isready -U kash -d kash || fail "M2-D-5 db not ready"
sleep 2
run_app() { docker run -d --name "$1" --network kash-d5 -e DATABASE_URL=postgres://kash:pw@kash-d5db:5432/kash -e "AUTH_SECRET=$SECRET" -e APP_URL=http://localhost:3000 "$IMAGE" >/dev/null; }
run_app kash-d5a & run_app kash-d5b & wait
healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$1")" = "healthy" ]; }
wait_for 120 healthy kash-d5a || fail "M2-D-5 first app not healthy"
wait_for 120 healthy kash-d5b || fail "M2-D-5 second app not healthy"
n=$(docker exec kash-d5db psql -U kash -d kash -tAc 'select count(*) from drizzle.__drizzle_migrations')
[ "$n" = "$EXPECTED" ] || fail "M2-D-5 migration table has $n rows, expected $EXPECTED (each migration once)"
pass "M2-D-5 concurrent start"

echo "All container tests passed."
