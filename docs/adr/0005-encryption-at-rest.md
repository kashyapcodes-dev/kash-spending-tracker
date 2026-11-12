# ADR-0005: Encryption at rest for secrets

- **Status:** Accepted
- **Date:** 2026-11-11
- **Milestone:** M5 (first use), M7

## Context

Kash will store secrets that give access to a user's financial data or cost money if leaked: Plaid access tokens and SimpleFIN access URLs (M5), and possibly user-supplied AI provider keys (M7). A database dump, a backup file or a SQL injection must not be enough to use them. Self-hosters will not run a key management service.

Passwords are out of scope here: Better Auth hashes them. Session tokens, invite tokens and API tokens are stored as hashes, not encrypted, because they never need to be read back.

## Decision

Application-level encryption of individual column values with a key from the environment.

- **Key.** `APP_ENCRYPTION_KEY` is 32 random bytes, base64-encoded. `docker/.env.example` documents how to generate one (`openssl rand -base64 32`). The app never generates or stores it.
- **Algorithm.** AES-256-GCM from Node's built-in `crypto`. A fresh random 12-byte IV for every encryption.
- **Key separation.** The environment key is not used directly. A per-purpose key is derived with HKDF-SHA256 using the purpose as info (for example `bank-token`, `ai-key`), so a value encrypted for one purpose cannot be decrypted as another.
- **Binding.** The additional authenticated data is `"<table>:<column>:<row id>"`. A ciphertext copied to another row fails to decrypt.
- **Stored format.** A text column holding `v1.<keyId>.<iv>.<ciphertext>.<tag>`, each part base64url. `keyId` is the first 8 hex characters of SHA-256 of the raw key, so the app can tell which key encrypted a value.
- **Rotation.** `APP_ENCRYPTION_KEY_PREVIOUS` may hold one older key. Decryption tries the key whose ID matches. A CLI command (`pnpm kash rotate-keys`, added in M5) re-encrypts all values with the current key, after which the previous key can be removed.
- **One module.** `packages/core/crypto` exports `encryptSecret(purpose, aad, plaintext)` and `decryptSecret(purpose, aad, stored)`. Nothing else in the codebase calls `crypto` ciphers.
- **Missing key.** The app boots without the key. Features that need it (bank connections, stored AI keys) are reported as unavailable in the UI and their endpoints return `503` with code `encryption_not_configured`. A key that is present but not 32 bytes is a boot error.
- **Handling.** Decrypted values live only in memory for the duration of a provider call. They are never logged, never returned by the API, and never sent to the AI model. API responses expose only whether a secret is set.

## Alternatives considered

- **Postgres `pgcrypto`.** The key travels in SQL statements and can appear in database logs; encryption is no longer independent of the database.
- **Disk or volume encryption only.** Does not protect dumps, backups or a compromised database connection.
- **An external KMS or Vault.** Right for a large hosted service, too heavy for self-hosting. Hosted mode can later wrap `APP_ENCRYPTION_KEY` with a KMS without changing the stored format, because of the `v1` prefix and key ID.
- **libsodium secretbox.** Fine cryptographically, but adds a native or WASM dependency for something Node provides.
- **A key per user derived from their password.** Background sync could not decrypt tokens when the user is not logged in.

## Consequences

- Losing `APP_ENCRYPTION_KEY` makes stored bank connections unusable. Users reconnect their banks; no transaction data is lost. `docs/self-hosting.md` must say to back the key up separately from the database.
- A database backup alone does not expose bank tokens.
- An attacker with both the environment and the database has everything. That is the accepted limit for a self-hosted app.
- Encrypted columns cannot be searched or indexed, which is not needed for these values.
