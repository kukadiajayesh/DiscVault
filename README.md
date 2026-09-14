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

This must be port 5173 (Vite, what the browser talks to), not 8787 (`wrangler dev`, what Vite
proxies `/api/*` to) — `apps/api/wrangler.jsonc`'s `PUBLIC_ORIGIN` var is already set to
`http://localhost:5173` to match; Better Auth computes the OAuth redirect from that var, so the
two must agree or Google rejects the callback with `redirect_uri_mismatch`.

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

### 3. Cloudflare resources

`apps/api/wrangler.jsonc` declares a D1 database and a KV namespace by ID. These IDs aren't
credentials (they're useless without your account's API token), so the file is committed as-is
— create the real resources and paste their IDs in:

```sh
cd apps/api
npx wrangler d1 create discvault-directory       # paste database_id into both d1_databases entries
npx wrangler kv namespace create PACKS           # paste id into kv_namespaces
cd ../..
```

The actual secrets (`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, etc.) never go in this file — they
live in `.dev.vars` (step 2, gitignored) locally and as encrypted Worker secrets in production
(`DEPLOYMENT.md`).

### 4. Local D1 database

```sh
pnpm --filter @discvault/api db:migrate:local
```

The directory starts in `invite` signup mode with an empty `invite` table, and sign-up is gated
on that table directly (`OPERATOR_SUBS` only grants the operator UI *after* an account exists) —
so the very first sign-in fails unless your email is invited first:

```sh
cd apps/api
npx wrangler d1 execute DIRECTORY --local --command \
  "INSERT INTO invite (email, created_at) VALUES ('you@gmail.com', datetime('now'))"
cd ../..
```

### 5. Run it

```sh
pnpm dev:api   # wrangler dev on :8787
pnpm dev:web   # vite on :5173, proxies /api to :8787
```

Open http://localhost:5173 and sign in with the Google account you invited above. Its `sub`
(Better Auth's `account.accountId`) isn't known until after this first sign-in — read it back and
put it in `OPERATOR_SUBS` (`.dev.vars`) to grant yourself the operator UI, then restart
`pnpm dev:api`:

```sh
cd apps/api
npx wrangler d1 execute DIRECTORY --local --command \
  "SELECT \"accountId\" AS sub FROM account WHERE \"providerId\" = 'google'"
cd ../..
```

### Everything else

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm import-legacy   # dvd_manager.mdb → discvault-legacy.dvault, uploads nothing
```

## Deploying

See `PENDING.md` §2.4 for the one-time Cloudflare setup (D1 database, KV namespace, secrets,
OAuth redirect for the production origin) before deploying.

```sh
pnpm build
pnpm db:migrate:remote
pnpm deploy:api
```

Note: `deploy` is a reserved pnpm CLI subcommand, so `pnpm --filter @discvault/api deploy` runs
pnpm's own deploy flow instead of the package script. Use `pnpm deploy:api` (or
`pnpm --filter @discvault/api run deploy`) instead.

For a click-by-click walkthrough of that setup — exact Cloudflare Dashboard and Google Cloud
Console navigation, in order — see `DEPLOYMENT.md`.
