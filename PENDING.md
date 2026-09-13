# DiscVault: build status and pending work

Snapshot of the second build pass (2026-09-13, session 2). Design reference:
`WEB_APP_ARCHITECTURE.md`. Nothing is committed yet.

---

## 1. Done and verified

| Area | Where | Verified by |
|---|---|---|
| pnpm monorepo, shared TS config, `.nvmrc`, `.gitignore` for build output, `.wrangler`, `.dev.vars`, `*.dvault` | root | `pnpm install` |
| **Shared protocol**: UUIDv7, item keys, path and date rules, synced-table definitions (one source for DDL and push validation), Zod API types, pack format (build, split into parts, parse), `.dvault` archive types, limits and quotas | `packages/sync-protocol` | 9 Vitest tests, `tsc` clean |
| **Schemas + migrations**: device DB (catalog, trigram FTS, outbox, conflicts, pending packs), vault DB (metadata, change log, quotas, pack parts), lookup seeds, `SqlDb` interface, `node:sqlite` adapter | `packages/schema` | 2 tests (trigram search works), `tsc` clean |
| **Vault logic** (`VaultStore`): push with idempotency, last write wins per field, disc-number conflicts, cascading deletes, daily quotas, pack reserve / upload / commit, replaced-pack purge list, paged backup export | `apps/api/src/vault/vault-store.ts` | 10 unit tests |
| **Worker API** (Hono): Google-only Better Auth, vault from session only, `VaultDO` (SQLite Durable Object per vault), D1 directory, sign-up modes and user cap, global KV guards, purge cron, devices, account deletion, operator routes, backup export routes | `apps/api` | 9 Miniflare tests, including the **two-user isolation test**; `tsc` clean; `wrangler deploy --dry-run` bundles (447 KB gzipped) |
| **Legacy archive builder**: `data/discvault.db` → `discvault-legacy.dvault` | `tools/import-legacy` | 1 test; ran on the real data: 311 discs, 42,840 folders, 345,215 files, 4.0 MB archive in ~3 s |
| **Web app scaffold**: `vite.config.ts` (React, PWA via `vite-plugin-pwa` generateSW, `/api` dev proxy, worker `format: es`, sqlite-wasm excluded from `optimizeDeps`), `tsconfig.json`, `index.html`, `main.tsx`, TanStack Router with placeholder routes for all 14 screens + the disc-explorer browse splat and settings splat | `apps/web` | `tsc` clean |
| **Local DB worker**: SQLite WASM + OPFS SAH pool (one file per vault, `vault-{vault_id}.sqlite3`), `SqlDb` adapter over the oo1 API, Web Locks so a second tab is refused rather than proxied, `navigator.storage.persist()`/`estimate()`, Comlink API (`open`, `close`, `wipe`, `search`, `stats`, `previewArchive`, `importArchive`, `exportArchive`, `sync`, `deviceId`) | `apps/web/src/db/worker.ts`, `db/rpc.ts` | `tsc` clean (Comlink/OPFS calls themselves need a browser, see §3.5) |
| **Archive import/export**: unzip + Zod manifest validation + part-hash + pack-hash verification, preview (counts, missing numbers, invalid dates, collisions), import (per-disc transaction: `writeRow` + local pack fields + `importPackParts` + staged `pending_pack_part` + `pack_commit` outbox entry, in that order so outbox `rowid` ordering is correct), skip/replace/renumber collision handling, export rebuilds `.dvault` from the local DB | `apps/web/src/archive/{import,export}.ts` | `tsc` clean, exercised indirectly by `db/packs.ts` tests |
| **Account layer**: Better Auth React client (`basePath: /api/auth`), Google sign-in/out, local account list in `localStorage` (profile + vault id + last used, so the app can open offline to a picker), `bootstrapAccount()` (`GET /api/account` → open vault DB → register device), `signOutAndWipe()` (deletes only that vault's OPFS file) | `apps/web/src/account` | `tsc` clean |
| **Repo tooling**: `biome.json`, `.github/workflows/ci.yml` (install, lint, typecheck, test), `README.md` (Google OAuth client, `.dev.vars`, D1 migrate, `pnpm dev:api`/`dev:web`) | root, `.github/` | `pnpm lint` clean over the whole repo |
| **Web app tests**: `prepareLocalDb`, `writeRow`/`deleteRow` (insert, update-in-place, unknown-column rejection, delete + outbox), `applyChanges` (server row applied, local edit re-applied on top, pack-refresh flagging), a full pack build → parse → `importPackParts` → `searchFiles` (trigram + LIKE fallback) → `catalogStats` → `removeDiscCatalog` round trip | `apps/web/test/db.test.ts` (node environment, `@discvault/schema/node`) | 8 Vitest tests |

Run everything: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm import-legacy`

All 39 tests across the 5 tested workspace projects pass; `pnpm typecheck` and `pnpm lint` are
clean over the whole repo, including `apps/web` (which had neither before this pass).

---

## 2. Pending

### 2.1 Web app UI (next — needs the Claude Design work first)
- [ ] Replace the 14 placeholder route components in `apps/web/src/routes.tsx` with real screens.
- [ ] App shell: top bar (search, "+ Add disc", sync indicator, user menu), left nav / bottom tab
      bar, 3-pane layout on wide screens.
- [ ] Wire `db/rpc.ts` (`vaultWorker()`) and `account/session.ts` (`bootstrapAccount`,
      `signOutAndWipe`) into the router (auth guard, loaders) and React Query.
- [ ] `scan/` (folder walk in a worker → pack) — not started; the scan wizard (screen 7) needs it.
      §8.00's deep-scan extras (archive contents, EXIF/ID3, thumbnails) are phase 3b, after MVP.

### 2.2 Tests still to write
- [ ] **Two-device sync test** (web, Node): device A imports a synthetic `.dvault` and syncs to an
      in-memory server built on `VaultStore`. Device B pulls and shows the same counts and search
      results. Both edit while offline, reconnect and end up the same. This is the main thing that
      would catch a mismatch between `SyncEngine`/`applyChanges` and `VaultStore`'s push/pull
      contract — none of the current tests exercise the two together.
- [ ] Sync engine edge cases: 429 → paused, 401 → signed out, network drop mid-upload resumes,
      conflict → `conflict` row, rejected → blocked.
- [ ] Worker test: `GET /api/auth/*` with Better Auth against D1 (sign-up hook creates the vault;
      invite-only or full blocks sign-up). Needs a mocked Google token endpoint.
- [ ] Browser-only paths that `tsc` checks but nothing runs yet: the OPFS SAH pool itself, the Web
      Locks "second tab refused" behavior, `navigator.storage.persist()`. Needs Playwright (or at
      least a real browser test runner) — `node:sqlite` can't stand in for these.
- [ ] Playwright offline tests (after screens): search offline, edit offline, reconnect.

### 2.3 Repo tooling still pending
- [ ] `.github/workflows/backup.yml` (nightly) — **blocked**: there's no API route to download an
      arbitrary vault's pack bytes with the ops token. `GET /api/packs/:disc/:hash/:part` is scoped
      to the signed-in user's own vault (`c.get("scope").vaultId`) and `/api/ops/vaults/:id/export`
      only returns the SQL rows (including `pack_part` metadata), never the KV bytes. Needs a new
      `requireOpsToken`-guarded route (e.g. `GET /api/ops/vaults/:id/packs/:disc/:hash/:part`)
      before the workflow can actually back up pack contents, not just metadata.

### 2.4 Cloudflare setup (needs your account; not done)
- [ ] Create the D1 database `discvault-directory` and KV namespace, then replace the placeholder
      IDs in `apps/api/wrangler.jsonc`.
- [ ] Google Cloud OAuth client. Redirect URIs: `http://localhost:5173/api/auth/callback/google`
      and the production origin.
- [ ] Secrets: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPS_TOKEN`,
      `OPERATOR_SUBS` (your Google `sub`).
- [ ] Set `PUBLIC_ORIGIN` for production (`apps/api/wrangler.jsonc` `vars` currently defaults it to
      `http://localhost:8787` for local dev).
- [ ] Phase 0 spike checks: no payment method is asked for, and Durable Object PITR works on the
      Free plan.

### 2.5 Owner onboarding (§3.8), once 2.1, 2.2 and 2.4 are done
- [ ] Deploy with `signup_mode = invite` and invite only your Google address.
- [ ] Sign in, run `pnpm import-legacy`, import the archive, sync until 0 pending.
- [ ] Check counts on a second device, then open sign-ups if wanted.

---

## 3. Decisions made this pass

| # | Item | Detail |
|---|---|---|
| 1 | Multi-tab DB access (was open) | A second tab is refused (`vault-open-elsewhere`) rather than proxied through a leader tab via `BroadcastChannel`. Simpler, no cross-tab RPC layer; a UI later can show "open in another tab". Revisit if that UX turns out to matter. |
| 2 | Local account list storage | `localStorage`, not a local DB table — it has to be readable before any vault DB is chosen/opened. Convenience only (`GET /api/account` is still the source of truth on every bootstrap). |
| 3 | Local import of pack-metadata columns | `writeRow` correctly rejects `serverOnly` columns (`pack_hash`, `folder_count`, etc. — a client must never push them). Archive import therefore writes those via a direct `UPDATE` after `writeRow`, then confirms them for real through the `pack_commit` outbox entry once pushed. |

## 4. Earlier decisions and mismatches (still open)

| # | Item | Detail | Suggested action |
|---|---|---|---|
| 1 | **Real counts differ from the architecture doc** | The DB has **42,840 folders / 345,215 files**. The doc says 42,841 / 345,216. The import tool checks the real numbers. | Update the doc (§3.8, §7, §12). |
| 2 | Pack size | Real archive is **3.8 MB of packs (4.0 MB file)**, largest 442 KB. Doc says 5.0 MB / 577 KB. | Update the doc. |
| 3 | Invalid dates | Tool finds **18** (impossible dates, or later than the build date). Doc says 396, likely a different rule (e.g. also dates later than the disc's entry date). | Pick the rule, then align `isValidCatalogDate`. |
| 4 | Media types | Inferred from size: DVD-5 223 / DVD-9 88. Doc says 224 / 86. Legacy data has no media type column. | Accept the inference, or edit discs after import. |
| 5 | Change feed | `/sync/changes` serves rows by `version` from the tables, not from `change_log`. This way pruning the log never breaks a device that is far behind; the log is kept for audit and conflicts only. | Update §6.3 and §9.2 to match. |
| 6 | API paths | All routes are under **`/api`** (`/api/sync/head`, …), so they don't collide with app routes like `/sync`. Added `POST /api/packs/reserve` before uploads. | Update §10 of the doc. |
| 7 | Extra tables | Device: `local_pack`, `pending_pack_part`. Vault: `pack_part`, `vault_meta`. Directory: `user.vaultId` column. | Update §9. |
| 8 | `compatibility_date` | Set to `2026-08-15` because the installed local `workerd` only supports up to 2026-08-22. | Raise it after upgrading wrangler/workerd. |
| 9 | `apps/api/src/worker-configuration.d.ts` | Generated by `wrangler types` (15K lines). | Keep it committed, or git-ignore it and generate in CI. |
| 10 | Files show as staged in git | New files are already staged (`A`), but nothing is committed. | Review, then commit when ready. |
