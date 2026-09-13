-- DiscVault directory (D1): who exists and which vault they own. No catalog data (§9.2).

-- ── Better Auth core tables (Google is the only provider) ────────────────
CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "vaultId" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" DATE,
  "refreshTokenExpiresAt" DATE,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE UNIQUE INDEX "account_provider_idx" ON "account" ("providerId", "accountId");

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATE NOT NULL,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

-- ── Vaults: the unit of data scope ───────────────────────────────────────
CREATE TABLE vault (
  id          TEXT PRIMARY KEY,                    -- UUIDv7; also the Durable Object name
  name        TEXT NOT NULL DEFAULT 'My discs',
  owner_id    TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);
-- One personal vault per user for now; dropping this index later allows more.
CREATE UNIQUE INDEX vault_owner_idx ON vault (owner_id) WHERE deleted_at IS NULL;

CREATE TABLE vault_member (
  vault_id    TEXT NOT NULL REFERENCES vault (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'owner',       -- 'owner' today; 'editor' / 'viewer' later
  created_at  TEXT NOT NULL,
  PRIMARY KEY (vault_id, user_id)
);

CREATE TABLE device (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  vault_id      TEXT NOT NULL REFERENCES vault (id) ON DELETE CASCADE,
  session_id    TEXT,
  name          TEXT,
  last_seen_at  TEXT,                              -- updated at most hourly
  revoked_at    TEXT
);
CREATE INDEX device_user_idx ON device (user_id);

-- ── Sign-up settings and shared free-tier guards ─────────────────────────
CREATE TABLE app_config  (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- signup_mode, max_users
CREATE TABLE invite      (email TEXT PRIMARY KEY COLLATE NOCASE, created_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE usage_daily (day TEXT PRIMARY KEY, kv_writes INTEGER NOT NULL DEFAULT 0,
                          kv_deletes INTEGER NOT NULL DEFAULT 0);
CREATE TABLE usage_total (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO usage_total (key, value) VALUES ('kv_bytes', 0);
CREATE TABLE purge_queue (kv_key TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0, delete_after TEXT NOT NULL);
CREATE INDEX purge_queue_due_idx ON purge_queue (delete_after);
