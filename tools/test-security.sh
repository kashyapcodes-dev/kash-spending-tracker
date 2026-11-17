#!/bin/sh
# M9: the security regression harness. Runs every test that guards an audit finding.
# Needs Postgres (pnpm db:up). Run from the repo root.
set -e
pnpm --filter @kash/integrations exec vitest run src/net src/bank
pnpm --filter @kash/core exec vitest run src/client-ip.test.ts
pnpm --filter @kash/contract exec vitest run src/limits.test.ts
pnpm --filter @kash/db exec vitest run src/security.test.ts
pnpm --filter @kash/web exec vitest run \
  test/security.test.ts test/security-meta.test.ts test/auth-m9.test.ts \
  test/verification.test.ts test/scrub.test.ts test/tokens-m9.test.ts \
  src/lib/safe-next.test.ts src/lib/security-headers.test.ts src/sw
