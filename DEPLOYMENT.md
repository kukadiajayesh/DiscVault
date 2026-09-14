# Deployment runbook

Every step to take DiscVault from local dev to a live, free-tier Cloudflare deployment with
Google sign-in — with exact dashboard navigation for the two consoles involved (Cloudflare
Dashboard and Google Cloud Console). Related: `README.md` (local dev setup), `PENDING.md` §2.4–2.5
(source checklist this runbook expands on).

Do these in order — later steps depend on IDs and URLs produced by earlier ones.

> **Run every `wrangler` command from `apps/api`, never from the repo root.** This is a pnpm
> workspace with more than one app (`apps/api`, `apps/web`); `wrangler` run from the root can't
> tell which one you mean and fails with `Cloudflare application detection logic has been run in
> the root of a workspace instead of targeting a specific project`. `cd apps/api` first, or use
> `pnpm --filter @discvault/api <script>` from the root — both land you inside `apps/api` before
> `wrangler` runs.

## Phase A — Google Cloud Console (identity)

### 1. Create a Google Cloud project

DiscVault only needs this project to issue an OAuth client — no Google APIs are called beyond
sign-in.

**Navigate:** `console.cloud.google.com` → project picker (top left, next to the logo) →
**New Project**

1. Name it `DiscVault` (or anything memorable) and click **Create**.
2. Wait for the notification bell to confirm creation, then use the project picker again to
   select it — every later step must happen inside this project.

### 2. Configure the OAuth consent screen

Required once per project before Google will issue any OAuth client.

**Navigate:** ☰ menu → **APIs & Services** → **OAuth consent screen**

1. User type: **External** (this app has no Workspace org) → **Create**.
2. App information: app name `DiscVault`, your support email, developer contact email.
3. Scopes: leave the default (Better Auth only requests `email` and `profile`) → **Save and
   continue**.
4. Test users: while the consent screen is in **Testing** publishing status, add every Google
   address that should be able to sign in (including your own) here — unlisted accounts will be
   blocked at the Google consent step regardless of DiscVault's own invite list.

> You can leave publishing status as **Testing** indefinitely for a personal app — no Google
> verification review needed as long as everyone who signs in is a listed test user.

### 3. Create the OAuth 2.0 Client ID

**Navigate:** APIs & Services → **Credentials** → **+ Create Credentials** → **OAuth client ID**

1. Application type: **Web application**. Name: `DiscVault web`.
2. Under **Authorized redirect URIs**, add the local dev URI now:
   ```
   http://localhost:5173/api/auth/callback/google
   ```
3. Leave a browser tab on this screen — you'll come back in **Phase C, step 11** to add the
   production redirect URI once you know your Worker's URL.
4. Click **Create**. A dialog shows your **Client ID** and **Client secret** — copy both now (the
   secret is hard to re-reveal later, though you can always regenerate it from this same
   Credentials page).

Paste these into `apps/api/.dev.vars` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (README
step 2) — needed before local sign-in works, separately from the production secrets in step 9.

## Phase B — Cloudflare Dashboard (resources)

### 4. Cloudflare account, free plan

If you don't already have one: `dash.cloudflare.com/sign-up` → email + password → verify email.
No payment method is requested anywhere in this flow — Workers, D1, KV and Durable Objects all
have Free plan tiers.

**Navigate:** `dash.cloudflare.com` → left sidebar → **Workers & Pages**

If this is the account's first Worker, Cloudflare will prompt you to claim a `*.workers.dev`
subdomain (e.g. `yourname.workers.dev`) — do that now, DiscVault will live at
`discvault.yourname.workers.dev` unless you attach a custom domain later.

### 5. Create the D1 database

**Navigate:** dash.cloudflare.com → **Storage & Databases** → **D1 SQL Database** → **Create**

1. Name it exactly `discvault-directory` (matches `apps/api/wrangler.jsonc`) → **Create**.
2. On the database's overview page, copy the **Database ID** (a UUID).

Equivalent terminal command, if you'd rather not click through the dashboard:
`npx wrangler d1 create discvault-directory` from `apps/api` — it prints the same ID.

### 6. Create the KV namespace

**Navigate:** Storage & Databases → **KV** → **Create instance**

1. Name it `PACKS` (or anything — the binding name in config is what matters, not this label) →
   **Add**.
2. Copy the **Namespace ID** shown after creation.

This namespace holds gzipped disc packs, keyed `v:{vault_id}:pack:{disc_no}:{sha256}:{part}` —
nothing to configure inside it.

### 7. Wire the IDs into `wrangler.jsonc`

`apps/api/wrangler.jsonc` is a normal tracked file — these resource IDs aren't credentials (they
can't be used without your account's API token), so committing them is fine; the real secrets
(step 9) never go in this file. Open it and paste the IDs from steps 5 and 6:

| Field | Where |
|---|---|
| `d1_databases[0].database_id` | D1 Database ID (step 5) — also set on the second, `remote: true` entry |
| `kv_namespaces[0].id` | KV Namespace ID (step 6) |

## Phase C — deploy, secrets, verify

### 8. First deploy

Two ways to do this — pick one.

**Option A — manual, from your machine.** The Worker has to exist before its Settings page
appears in the dashboard, and D1 migrations have to run against the remote database at least
once:

```sh
pnpm build
cd apps/api
npx wrangler d1 migrations apply DIRECTORY --remote
npx wrangler deploy
cd ../..
```

**Option B — Cloudflare Workers Builds (auto-deploy on git push).** Connect the repo:

**Navigate:** Workers & Pages → **Create** → **Import a repository** (or, on an existing Worker,
**Settings** → **Build** → **Connect**) → pick this GitHub repo → branch `main`

This repo is a pnpm workspace with more than one app (`apps/api`, `apps/web`), so the build
config must be scoped to `apps/api` or it fails with
`Cloudflare application detection logic has been run in the root of a workspace`:

| Field | Value |
|---|---|
| Root directory | `apps/api` |
| Build command | `cd ../.. && pnpm install && pnpm --filter @discvault/web build` (the Worker serves `apps/web/dist` as static assets, so the web app must be built first) |
| Deploy command | `npx wrangler deploy` |

With either option, note the deployed URL, e.g. `https://discvault.yourname.workers.dev` —
you'll need it in steps 10 and 11. This first deploy will 500 on auth routes until secrets are
set (next step) — that's expected.

### 9. Set production secrets

**Navigate:** Workers & Pages → **discvault** → **Settings** → **Variables and Secrets** →
**+ Add**

Add each row below, toggling **Encrypt** on (this makes it a secret, unreadable again from the
dashboard after saving) — then **Save and deploy**:

| Name | Value |
|---|---|
| `BETTER_AUTH_SECRET` | 32+ random chars — generate fresh for production, don't reuse the local one: `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | from Phase A, step 3 |
| `GOOGLE_CLIENT_SECRET` | from Phase A, step 3 |
| `OPS_TOKEN` | another long random token — guards the backup workflow and `/api/ops/*` routes |
| `OPERATOR_SUBS` | your Google account's `sub` claim (comma-separated for more than one) — grants the operator UI |

Equivalent per-secret terminal command: `npx wrangler secret put BETTER_AUTH_SECRET` (prompts
for the value) from `apps/api`.

### 10. Point `PUBLIC_ORIGIN` at the real URL

`vars` live in `wrangler.jsonc` and are pushed on every deploy, so edit the file rather than the
dashboard (a dashboard edit would just get overwritten by the next `wrangler deploy`):

```jsonc
"vars": {
  "PUBLIC_ORIGIN": "https://discvault.yourname.workers.dev",
  "DEFAULT_SIGNUP_MODE": "invite"
}
```

Swap in your workers.dev URL from step 8 (or a custom domain, attached under the Worker's
**Settings → Domains & Routes**). Redeploy: `pnpm --filter @discvault/api deploy`.

### 11. Add the production redirect URI

Back to the OAuth client from Phase A.

**Navigate:** APIs & Services → **Credentials** → **DiscVault web** (under OAuth 2.0 Client IDs)

Under **Authorized redirect URIs**, click **+ Add URI** and add:

```
https://discvault.yourname.workers.dev/api/auth/callback/google
```

using the same origin as `PUBLIC_ORIGIN` from step 10. **Save**.

### 12. Verify free-tier bindings

**Navigate:** Workers & Pages → **discvault** → **Settings** → **Bindings**

1. Confirm `DIRECTORY` (D1), `PACKS` (KV) and `VAULT` (Durable Object, class `VaultDO`) all show
   up bound.
2. Under account **Billing** (top-right avatar → **Billing**), confirm plan is **Free** and no
   payment method is on file — Workers Free, D1 Free and KV Free all cover this app's usage;
   Durable Object storage is billed on the Workers Paid plan for high-volume use but small
   SQLite-backed objects like this fit inside the Free allowances.
3. Visit your deployed URL, sign in with the Google account you put in `OPERATOR_SUBS`, and
   confirm you land on the app instead of an auth error.

### 13. Owner onboarding

With `DEFAULT_SIGNUP_MODE` still `invite`, only operator accounts can sign up — so sign in as
yourself first, then move the legacy catalog in:

1. `pnpm import-legacy` — builds `discvault-legacy.dvault` from `dvd_manager.mdb`, uploads
   nothing.
2. In the app, import that archive into your vault, then sync until 0 pending on a second device
   to confirm packs round-trip.
3. Once you're happy with the counts, open sign-ups if wanted via `PUT /api/ops/config`
   (operator-only route).

---

Cloudflare dashboard menu labels change occasionally — if a label above doesn't match what you
see, the resource type (D1 / KV / Workers) is still the thing to search for in the sidebar.
