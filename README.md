# DiscVault

Offline-first disc catalog PWA. Architecture: `WEB_APP_ARCHITECTURE.md`. Build status and what's
left: `PENDING.md`.

## Local dev setup

Requires Node 22 (`.nvmrc`) and pnpm 10.

```sh
pnpm install
```

### 1. Google OAuth client

Create an OAuth 2.0 Client ID (Web application) in the Google Cloud Console. Authorized redirect
URI for local dev:

```
http://localhost:5173/api/auth/callback/google
```

### 2. API secrets

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Fill in `apps/api/.dev.vars`:

| Key | Value |
|---|---|
| `BETTER_AUTH_SECRET` | 32+ random characters, e.g. `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 1 |
| `OPS_TOKEN` | a long random token, used by the backup workflow and ops routes |
| `OPERATOR_SUBS` | your Google account's `sub` (comma-separated if more than one), grants the operator UI |

### 3. Local D1 database

```sh
pnpm --filter @discvault/api db:migrate:local
```

### 4. Run it

```sh
pnpm dev:api   # wrangler dev on :8787
pnpm dev:web   # vite on :5173, proxies /api to :8787
```

Open http://localhost:5173 and sign in with the Google account whose `sub` you put in
`OPERATOR_SUBS` (the directory starts in `invite` signup mode with no invites, so only operators
can sign up until you open it up — see `PUT /api/ops/config`).

### Everything else

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm import-legacy   # dvd_manager.mdb → discvault-legacy.dvault, uploads nothing
```

## Deploying

See `WEB_APP_ARCHITECTURE.md` §3.7 and `PENDING.md` §3.7 for the one-time Cloudflare setup (D1
database, KV namespace, secrets, OAuth redirect for the production origin) before
`wrangler deploy`.
