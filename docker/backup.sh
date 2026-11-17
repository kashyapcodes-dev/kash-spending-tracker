#!/bin/sh
# Write a timestamped pg_dump of the Kash database and prune old dumps.
#   docker/backup.sh [backup-dir] [keep-count]     defaults: ./backups, 14
# Run from the repo root. Restore: see docs/self-hosting.md.
set -e
dir="${1:-./backups}"
keep="${2:-14}"
compose="docker compose -f docker/compose.yml"
# Dumps hold every budget in plain form: owner-only directory and files. Encrypt before copying off the host.
umask 077
mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/kash-$(date -u +%Y%m%dT%H%M%SZ).dump"
$compose exec -T db pg_dump -U kash -d kash --format=custom > "$file"
[ -s "$file" ] || { echo "backup is empty, removing" >&2; rm -f "$file"; exit 1; }
chmod 600 "$file"
echo "wrote $file (mode 600; encrypt it before storing it elsewhere, for example: age -p -o $file.age $file)"
# Keep the newest $keep dumps.
ls -1t "$dir"/kash-*.dump | tail -n +"$((keep + 1))" | while read -r old; do rm -f "$old"; done
