#!/bin/sh
# Create docker/.env from the example with freshly generated secrets. Refuses to overwrite.
set -e
cd "$(dirname "$0")"
[ -e .env ] && { echo "docker/.env already exists; not touching it." >&2; exit 1; }
cp .env.example .env
pw=$(openssl rand -hex 24)
secret=$(openssl rand -base64 32 | tr -d '\n')
# Portable in-place edit (GNU and BSD sed).
sed "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pw|; s|^AUTH_SECRET=.*|AUTH_SECRET=$secret|" .env > .env.tmp
mv .env.tmp .env
# Separate passwords for the three database roles (ADR-0014).
for v in KASH_APP_DB_PASSWORD KASH_MIGRATOR_DB_PASSWORD KASH_JOBS_DB_PASSWORD; do
  printf "%s=%s\n" "$v" "$(openssl rand -hex 24)" >> .env
done
chmod 600 .env
echo "Wrote docker/.env with generated secrets. Back it up: losing AUTH_SECRET signs everyone out."
