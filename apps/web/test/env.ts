// Plain strings: this file runs in every test worker before any module reads the environment.
// M9: the app connects as the least-privileged role; global-setup migrates as the owner.
process.env.DATABASE_URL =
  process.env.TEST_APP_DATABASE_URL ??
  "postgres://kash_app:kash_app@localhost:54329/kash_test";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.APP_URL = "http://localhost:3000";
process.env.KASH_DISABLE_AUTH_RATE_LIMIT = "true";
// M5: a fixed test key (never used outside tests), the scripted fake bank, and no queue worker.
process.env.APP_ENCRYPTION_KEY = "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktMTIzNDU=";
process.env.KASH_FAKE_BANK = "true";
process.env.WORKER_MODE = "off";
// M7: a scripted model, never a real provider.
process.env.AI_PROVIDER = "fake";
// M9: tests simulate a reverse proxy, so X-Forwarded-For is read (right-most untrusted entry).
process.env.TRUSTED_PROXY = "loopback";
