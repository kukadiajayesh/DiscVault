# DiscVault: Offline-First Web App Architecture

DiscVault is a catalog of 311 CD/DVD discs (42.8K folders, 345K files, about 1.6 TB). Its
main job is to answer **"which physical disc holds this file?"** It should do that
**instantly, on any device, with or without internet**.

This document replaces all earlier architecture and tech-stack plans.

**Two hard constraints:**
1. **Free tier only, forever.** No payment method on any account, so the app can never produce a bill. Every service used either has no usage limit or stops working at its limit instead of charging.
2. **Future-proof.** Adding more discs (hundreds or thousands), new media types or new metadata must not need a redesign. If a free tier disappears, moving elsewhere must not lose data.

---

## 1. Core idea

> **Every device keeps a complete copy of the catalog in a real SQLite database inside the
> browser. The server only exists to sync devices and keep backups.**

Why this suits DiscVault:
- **The data is small enough.** Measured on the real data, the full catalog is only **~5 MB
  gzipped** to download. Stored locally with search indexes it measures **109 MB**, which
  is fine on a laptop or phone.
- **Almost everything is reading and searching.** Search, browse, stats and duplicate checks
  run on the local database, so they need no network and have no round-trip delay.
- **Writes are rare and small**: adding tags, notes, locations or loans, and occasionally
  scanning a new disc. They can be queued while offline and pushed later.
- **Scanned disc contents never change** once scanned. A re-scan replaces the whole disc.
  That means the file data can be shipped as one file per disc ("disc packs") instead of
  syncing 345K rows one at a time.

```
┌──────────────────────── Any device (installed PWA) ─────────────────────────┐
│                                                                              │
│  UI thread (React)                    Web Worker                             │
│  ┌──────────────────────┐   RPC   ┌───────────────────────────────────────┐ │
│  │ Screens, tables,     │ ──────► │ SQLite WASM  ── OPFS file (~110 MB)   │ │
│  │ search box, charts   │ ◄────── │  • disc / folder / file + FTS5 search │ │
│  └──────────────────────┘ results │  • tags, locations, loans, notes      │ │
│            ▲                      │  • outbox (changes not yet pushed)    │ │
│            │                      │ Sync engine (pull / push / packs)     │ │
│  Service Worker                   └───────────────────┬───────────────────┘ │
│  (caches app shell → opens offline)                   │ only when online     │
└───────────────────────────────────────────────────────┼──────────────────────┘
                                                        │ HTTPS
                     ┌──────────────────────────────────▼───────────────────────┐
                     │ Cloudflare Worker, Free plan (Hono API + static assets)   │
                     │   /auth/*  /sync/head  /sync/changes  /sync/push  /packs  │
                     ├──────────────────────────┬────────────────────────────────┤
                     │ D1 Free (SQLite)         │ Workers KV Free                │
                     │ • users, sessions        │ • pack:{disc}:{hash}:{part}    │
                     │ • disc metadata + hash   │   (gzipped JSON, immutable)    │
                     │ • tags, locations, loans │                                │
                     │ • change_log (seq)       │                                │
                     └────────────▲─────────────┴───────────────▲────────────────┘
                                  │ nightly (wrangler export)    │
                     ┌────────────┴──────────────────────────────┴────────────────┐
                     │ GitHub Actions (free) → private "discvault-backup" repo    │
                     └────────────────────────────────────────────────────────────┘
```

---

## 2. Tech stack

### Frontend: installable PWA
| Layer | Choice | Why |
|---|---|---|
| Build | **Vite** | Fast, and outputs a static SPA that the service worker can cache in full. |
| UI | **React 19 + TypeScript** | Largest ecosystem for data-heavy UI. |
| Routing | **TanStack Router** (SPA mode) | Type-safe URL search params, which fits a filter-heavy search screen (`/search?q=&cat=&disc=`). |
| **No SSR framework** | Not Next.js, not TanStack Start | Server rendering needs the network to draw a page. An offline-first app has to start from a cached shell and read local data, so SSR adds complexity with no benefit. |
| Local database | **Official SQLite WASM** (`@sqlite.org/sqlite-wasm`) with the **OPFS SAH-pool** storage backend | Real SQLite from the SQLite team. Supports FTS5 including the trigram tokenizer (tested). Works in Chrome, Edge, Firefox and Safari 16.4+. Needs no special COOP/COEP headers. |
| DB threading | Dedicated **Web Worker** + Comlink RPC. With several tabs open, **Web Locks** elects one tab to own the DB and the others send it queries over `BroadcastChannel`. | Keeps queries off the UI thread. The SAH-pool backend allows only one connection at a time. |
| Query layer | **Drizzle ORM** (`sqlite-proxy` driver to the worker), with raw SQL for FTS | Typed queries. The same schema definitions are used on the server with D1. |
| Reactive data | **TanStack Query**, with cache keys per table that are invalidated after local writes and sync pulls | Screens update automatically when a sync brings new data. |
| Offline shell | **vite-plugin-pwa** (Workbox): precaches JS, CSS, WASM and fonts, and falls back to the app for any URL | App opens with no network. Shows an "Update available → Reload" prompt. |
| UI kit | **shadcn/ui** (Radix + Tailwind CSS v4), lucide icons, **cmdk** (⌘K) | Accessible components that are part of your own code. |
| Big lists | **TanStack Table + TanStack Virtual** | Smooth scrolling through hundreds of thousands of rows and deep folder trees. |
| Charts | **Recharts** | Enough for the Stats screen. |
| Forms | **react-hook-form + Zod**, with the Zod schemas shared by client and API | One validation definition used on both sides. |
| Disc scanning | `showDirectoryPicker()` (Chrome, Edge), falling back to `<input webkitdirectory>` (Safari, Firefox), parsed in a worker | Reads only names, sizes and dates. **Works offline.** |

### Backend: free tier only (no payment method on any account)
| Layer | Choice | Why |
|---|---|---|
| Hosting + API | **One Cloudflare Worker (Free plan)** with **Static Assets** for the PWA and **Hono** for the API | Static asset requests are **free and unlimited** and don't count toward the Worker's 100K requests/day. Only API calls do. |
| Server DB | **Cloudflare D1 Free** (SQLite) | Same SQL dialect as the client. It stores **only metadata** (discs, tags, locations, loans, change log), never the 345K file rows. Uses under 1% of the 500 MB limit. |
| Disc packs | **Workers KV Free** | 1 GB storage, 25 MiB max per value, no card needed, and it **stops at the limit instead of billing**. Packs never change and are named by content hash, so KV's eventual consistency doesn't matter. |
| ~~R2~~ | **Not used** | R2 needs a payment method to enable and bills past its free allowance, which breaks the "never billed" rule. |
| Auth | **Better Auth** with **GitHub or Google sign-in + passkeys** (no passwords). Uses a signed session cookie cache, so most requests don't read D1. | Password hashing takes far more than the Free plan's **10 ms CPU per request**. OAuth and passkeys are cheap. Long sessions keep the app usable offline. |
| Backups | **GitHub Actions** (free scheduled workflow) runs `wrangler d1 export` + new packs → commits to a **private backup repo** | Cron Triggers also have only 10 ms CPU, too little for exports. Actions use about 1 minute a day. |
| Point-in-time restore | **D1 Time Travel** (7 days on Free) | Undoes a bad sync or accidental delete. |
| Change-log pruning | Workers Cron Trigger (1 of 5 free) running one `DELETE … LIMIT` | A single statement fits easily in 10 ms CPU. |

**Cost: $0, guaranteed.** With no payment method on the account, Cloudflare has nothing to
charge. Going over a limit makes the API return errors, and the app handles that gracefully
(§3.2). See §3 for the full budget.

### Tooling
- **pnpm monorepo**, TypeScript everywhere, Biome for lint and format.
- **Vitest** for sync-engine and query tests, run against real catalog data.
- **Playwright** for end-to-end tests, including `context.setOffline(true)` tests for search, editing while offline, and reconnecting to sync.
- **One-time legacy import tool** that reads the existing `dvd_manager.mdb` / SQLite export, builds 311 disc packs and seed metadata, and uploads them.

### Why write our own sync instead of using a sync engine?
| Option | Verdict |
|---|---|
| **Our own packs + outbox sync (chosen)** | Suits this data: bulk scan data that never changes plus a small amount of edited metadata. Fits entirely in free tiers and uses SQLite on both ends. The sync code is roughly 800 lines that we own and test. |
| PowerSync | Production-ready and has SQLite + FTS5 on the web. But it needs Postgres plus the PowerSync service. Cloud free projects pause after a week of inactivity, and the alternatives are paid plans or running your own server, so it **doesn't meet the free-only rule**. |
| Turso browser sync | Still **alpha/beta** as of Sept 2026, so not safe for your only copy of the catalog. |
| ElectricSQL / Zero / InstantDB | Built for partial, server-driven data. Search needs the full 345K rows on the device, which doesn't suit them. |

### Runs on every device, from one codebase
| Device | How |
|---|---|
| Windows / Linux / ChromeOS | Chrome or Edge, then **Install app**. Opens in its own window and works offline. |
| macOS | Chrome or Edge (Install), or Safari (**File → Add to Dock**). |
| Android | Chrome, then **Install app**. |
| iPhone / iPad | Safari **Share → Add to Home Screen**. This is required on iOS so the local DB isn't cleared after 7 days of not opening the site. |
| Disc scanning | Desktop only, because that's where disc drives are. Best in Chrome or Edge. |

---

## 3. Free-tier budget and guard rails

### 3.1 Limits vs. expected use
Assumed use: 3 devices, about 50 edits a day, a few new discs a week.

| Resource | Free limit | Typical day | Heavy day | If the limit is hit |
|---|---|---|---|---|
| Worker API requests | 100,000 / day | ~300 | ~2,000 (setting up a new device) | API returns an error. **The app keeps working offline** and sync resumes after 00:00 UTC. |
| Worker CPU | 10 ms / request | < 5 ms per endpoint | – | Each endpoint is designed to stay small: no password hashing, no gzip work on the server, packs streamed straight from KV, small JSON. |
| Static assets (the PWA) | Unlimited | – | – | – |
| D1 rows read | 5M / day | < 5K | ~50K | Sync pauses until the next day. |
| D1 rows written | 100K / day | < 1K (about 5 per edit, counting change log and indexes) | ~50K (tagging 10K files) | Push gets a 429, and the outbox keeps the rest for tomorrow. |
| D1 queries / request | 50 | – | – | Client sends at most 20 changes per push (2 statements each). |
| D1 storage | 500 MB | < 5 MB | – | Only metadata is stored here (see §4). |
| KV reads | 100K / day | < 500 | ~350 per new device | Device setup can resume the next day. |
| KV writes | 1,000 / day | 0–5 (one per new or re-scanned disc) | 311 (legacy import) | Import tool spreads work over days if needed. |
| KV storage | 1 GB | 5 MB | – | See §4. |
| Cron Triggers | 5 per account | 1 | – | – |
| GitHub Actions (private repo) | 2,000 min / month | ~1 min | – | That day's backup is skipped. |

**Cost of adding one disc:** 1 KV write, about 5 D1 row writes and 2 API requests. The free
tier could absorb **hundreds of new discs a day**.

### 3.2 Guard rails built into the design
1. **No payment method anywhere.** Cloudflare can't bill an account with no card, and R2 is not used because it needs one.
2. **Hitting a limit never breaks the app.** All reads are local. Limit errors return `429 {retryAfter}`, and the sync indicator shows *"Cloud sync paused until 05:30 (daily free limit). Everything still works offline."*
3. **Cheap polling.** `GET /sync/head` reads a single row and returns the current `seq`. Changes are fetched only when that number has moved. Checks run on app open, window focus and reconnect, then every 15 minutes while the app is visible. Nothing runs in the background.
4. **Bulk actions stay small.** A tag on a folder or disc applies to everything inside it (matched by `item_key` prefix), so tagging a 20K-file disc writes 1 row, not 20K. The client also limits itself to about 10K metadata writes per day and leaves the rest queued.
5. **Pushes are split** into chunks under D1's 50-queries-per-request and the 10 ms CPU limit.

---

## 4. Growth and future-proofing

### 4.1 Measured baseline and projections
Measured on today's data: 311 discs, 388K file and folder rows, **5.0 MB** of gzipped packs, and
a **109 MB** local DB (84 MB of that is data and indexes, the rest is search index). That
averages **~1,250 rows, 16 KB of pack data and 350 KB of local DB per disc**.

| Discs | Files + folders | KV packs (1 GB free) | D1 (500 MB free) | Local DB per device | Works? |
|---|---|---|---|---|---|
| **311 (today)** | 388K | 5 MB (0.5%) | < 5 MB | 109 MB | ✓ every device |
| 500 | 625K | 8 MB | < 5 MB | 175 MB | ✓ every device |
| 1,000 | 1.25M | 16 MB | < 10 MB | 350 MB | ✓ every device |
| 2,500 | 3.1M | 40 MB | < 20 MB | ~875 MB | ✓ desktop · phones use **Lite mode** |
| 5,000 | 6.2M | 80 MB (8%) | < 40 MB | ~1.75 GB | ✓ desktop · phones use **Lite mode** |

**The free tier is not what limits growth.** 1 GB of KV holds about 60,000 average discs. The
only thing that grows noticeably is local storage on each device, and browsers allow installed
apps a large share of disk (Chrome allows up to 60% of the disk per site).

### 4.2 How the design scales
- **Packs are split into parts** of up to about 2 MB gzipped. A future hard-drive or USB scan with 500K files becomes several parts. Parts are downloaded in parallel, and setup can resume.
- **Everything is incremental.** Devices download only discs whose pack hash changed. The head check costs one row read no matter how big the catalog is.
- **Lite mode** for phones and small devices uses a word-based search index instead of the part-of-word index and skips the duplicate and size indexes. That measured **79 MB instead of 109 MB** today. It can be switched per device, and is suggested automatically when the DB would take more than 25% of free space.
- **UI speed doesn't depend on catalog size.** Lists are virtualized, the folder tree loads lazily, and search results are paged.

### 4.3 A schema that grows without rebuilds
- **Lookup tables instead of `CHECK` lists** for media type, disc status, location kind and file category. SQLite can't change a `CHECK` constraint without rebuilding the table, but new kinds like USB, HDD, BD-XL or LTO tape can simply be added as rows. `media_type` also stores `capacity_kb`.
- **`disc_no INTEGER`** has no upper limit, and an optional **`label`** allows names like "12A" or "Blu-ray 3".
- **`meta` JSON column** on disc, folder and file holds future data (checksum, video duration, EXIF, ID3) with no migration. New pack versions (`v: 2`) just fill it.
- **Migrations only add**: new tables and new columns, never renaming or dropping in place. Local migrations use `PRAGMA user_version`, and D1 uses `wrangler d1 migrations`.
- **Versioned formats**: packs carry `v`, and the sync API uses a `DV-Protocol` header. The server accepts the current and previous version, and an older app is asked to update.

### 4.4 No lock-in: the exit plan
- **Data is always in open formats** (SQLite files and gzipped JSON), stored in three places: every device, Cloudflare, and the nightly private GitHub backup repo.
- **The backend sits behind two small interfaces.** `MetaStore` is D1 today and could be any SQLite (better-sqlite3 on a home PC or Raspberry Pi, or an always-free VM). `PackStore` is KV today and could be a filesystem or any object store. Hono runs unchanged on Node, Bun or Deno. Moving hosts means swapping two adapters.
- **Local-only mode**: with sync turned off, the app runs completely on one device with no backend, using export/import of a backup zip. **If every free tier disappeared tomorrow, the app would still work.**

---

## 5. Offline design

### 5.1 What works offline
| Feature | Offline? | Notes |
|---|:-:|---|
| Open the app | ✓ | Service worker loads the cached shell. |
| Search, filters, ⌘K | ✓ | Local FTS5. Expect results in tens of milliseconds. |
| Browse discs and folders | ✓ | Local tree queries. |
| Dashboard, stats, duplicates, data health | ✓ | Computed locally and cached in local tables. |
| Edit disc info, tags, notes, collections, locations, loans | ✓ | Saved locally right away and added to the outbox. |
| **Scan a new disc or re-scan one** | ✓ | Pack is built and stored locally, then uploaded when back online. |
| Export CSV, print labels | ✓ | Generated in the browser. |
| First sign-in and first catalog download | ✗ | Needs internet **once per device**. |
| Seeing other devices' changes | ✗ | Arrive on the next sync. |
| Downloading a server backup | ✗ | Online only. |

### 5.2 First launch on a new device (bootstrap)
1. Sign in (online). The session token and user profile are saved on the device.
2. Ask the browser for persistent storage (`navigator.storage.persist()`) and check available space (`estimate()`).
3. `GET /sync/manifest` returns `[{disc_no, pack_hash, parts, bytes}]` plus the current `seq`. It is only called during setup; after that, pack changes arrive through the change log.
4. Download all packs in parallel (**~5 MB total**) and unzip them with the browser's built-in `DecompressionStream`.
5. In the worker, insert each disc in one transaction, then build the FTS indexes. A progress screen shows each step.
6. `GET /sync/changes?since=0` fetches tags, locations, loans and other metadata.
7. Save `last_seq`. From now on the device works fully offline.

### 5.3 Two sync channels
Different kinds of data change in different ways, so they sync differently:

**A) Disc packs, for scan data (large, never edited)**
- One gzipped JSON file per disc (split into ~2 MB parts if large), `{disc, folders[], files[]}`, stored in **Workers KV** under a key that includes its content hash.
- A re-scan creates a new pack with a new hash. The manifest points to it.
- Pull: compare the local and server manifests, download only changed packs, and replace that disc's folders and files in one transaction.
- Push: a scan done offline is saved as a pending pack blob in OPFS. When online, upload each part with `PUT /packs/:disc/:hash/:part` (the Worker streams it into KV), then commit the disc's new pack hash through `/sync/push`.

**B) Row changes, for user metadata (small, editable)**
- Tables: `disc` fields, `location`, `tag`, `tag_link`, `collection`, `collection_item`, `saved_search`, `borrower`, `loan`, `item_note`, `category_override`.
- Every local edit runs in **one local transaction**: update the row and append to `outbox`. The UI updates immediately.
- Push: `POST /sync/push` sends a batch of outbox entries. Each entry has a UUID, so resending after a network drop doesn't duplicate anything. The server applies them in order, records each in `change_log` (`seq` counts up), and returns the new version numbers.
- Pull: `GET /sync/changes?since=<last_seq>` returns upserts and delete markers ("tombstones").
- When sync runs: when the app starts, when the network comes back, when the tab gets focus, every 15 minutes while visible, and right after a local write (debounced). Each check starts with `GET /sync/head`, which reads 1 row, and fetches changes only if `seq` has moved.

### 5.4 Conflicts
| Situation | Rule |
|---|---|
| The same field edited on two devices while offline | **Last write wins, per field**, in the order the server receives them. The losing value is kept in `change_log` and shown in Sync → History. |
| One device deletes a tag while another assigns it | The delete wins. The assignment is dropped and reported. |
| Two devices create the **same disc number** while offline | The server accepts the first. The second goes to **Sync → Conflicts** ("Disc 322 already exists → use 323 / merge / discard"). |
| Two devices re-scan the same disc | The newer scan wins. The older pack is kept in KV for 30 days and can be restored. |
| Session expired while offline | Local use continues normally. On reconnect you're asked to sign in again, then the outbox is sent. **Nothing is lost.** |

### 5.5 IDs that work offline
- **Discs** use `disc_no`, the number written on the physical disc, chosen by the user.
- **Metadata rows** (tags, locations, loans…) use **UUIDv7** generated on the device, so there are no collisions and no server needed.
- **Folders and files** get local integer IDs that are never synced. Anything that points at a file or folder (a tag, a note, a collection entry) uses a stable **item key**: `d:116`, `p:116:movies/constantine`, or `f:116:movies/constantine/cd1.avi` (lower-cased path relative to the disc). Tags and notes therefore survive a re-scan as long as the file is still there.

### 5.6 Keeping local data safe
- `navigator.storage.persist()` asks the browser not to clear storage. On iOS the app must be added to the Home Screen to avoid the 7-day cleanup.
- **The server can always rebuild a device**, so a cleared browser loses only unsynced outbox entries. The Sync screen shows the count and warns before a risky action.
- Local schema upgrades run in the worker using `PRAGMA user_version` whenever a new app version loads.
- "Sign out & wipe this device" deletes the OPFS database.

### 5.7 Offline-first UI rules
- Never make the user wait on the network. Screens read local data only.
- The top bar shows a sync indicator: **● Synced · ◐ Syncing · ○ Offline · ▲ 3 changes pending · ⚠ Conflict**.
- Items waiting to upload show a small "pending" badge.
- Actions that need the network are disabled when offline and explain why.

---

## 6. Data profile (from the real catalog)

| Fact | Value | Design impact |
|---|---|---|
| Discs | 311, numbered 1–321 | **10 numbers missing** (2, 46, 114, 115, 158–161, 170, 177). Shown on the Data Health screen. |
| Folders / files | 42,841 / 345,216 | Lists are virtualized. The folder tree loads one level at a time. |
| Total size | ~1.6 TB. 224 discs are DVD-5 size, 86 are DVD-9 size | Media type and a capacity bar for each disc. |
| Size unit in source | **KB** | Stored as `size_kb` and formatted for display. |
| Extensions | 1,669 raw values, 1,405 after lower-casing. 7,297 files have none | Store lower case. Map extensions to **categories**. |
| Paths | Start with the drive letter used at scan time (`G:\` on 205 discs, `D:\`, `I:\`…) | Store paths **relative to the disc** and remove the drive letter. |
| Tree depth | Up to 15 | Tree loads lazily. |
| Root-level files | 867 | The explorer has a "(disc root)" node. |
| Empty disc | #185 | Flagged in Data Health. |
| Invalid dates | 396 (`1900-01-00`, 2027…) | `date_valid = 0`, and left out of charts. |
| Unused legacy columns | comment, size-type columns (always empty) | Dropped. |
| Likely duplicates | ~5.5K groups (same name and size on different discs, > 1 MB) | Duplicates screen. |
| Pack sizes | **5.0 MB gzipped total** (25 MB raw). Median 1 KB, largest 577 KB | Fast first sync, even on mobile data. |

---

## 7. Screens

### 7.0 Features seen in similar apps, and where each one lives
| Feature | WinCatalog | NeoFinder | Cathy/VVV | catcli | DiscVault | Where | Offline |
|---|:-:|:-:|:-:|:-:|---|---|:-:|
| Global quick search | ✓ | ✓ QuickFind | ✓ | ✓ | **MVP** | ⌘K (A), Search (4) | ✓ |
| Advanced search / operators | ✓ | ✓ Find Editor | – | – | **MVP** | Search (4): operators + filter panel | ✓ |
| Browse a disc like Explorer | ✓ 3-pane | ✓ | ✓ | ✓ `ls` | **MVP** | Disc explorer (6) | ✓ |
| Physical location ("Wallet 1, page 5") | ✓ | ✓ | – | – | **MVP** (the whole point of the app) | Edit disc (C), item drawer (B), Locations (13) | ✓ |
| Add or re-scan a disc | ✓ | ✓ | ✓ | ✓ | **MVP** (scan in the browser) | Scan wizard (7) | ✓ |
| Tags on disc/folder/file | ✓ | ✓ | – | – | After MVP (phase 4) | Collections & tags (12), drawer (B) | ✓ |
| Virtual folders / smart folders | ✓ | ✓ | – | – | After MVP (phase 4) | Collections + Saved searches (12) | ✓ |
| Duplicate finder | ✓ name/size/date | ✓ files and folders | – | – | After MVP (phase 4) | Duplicates (10) | ✓ |
| Lending tracker | ✓ | – | – | – | After MVP (phase 4) | Locations & loans (13) | ✓ |
| Stats / disk usage | ✓ | ✓ | – | ✓ `du` | After MVP (phase 4) | Stats (11), Disc explorer → Overview (6) | ✓ |
| Export CSV/HTML, print | ✓ | ✓ | ✓ | ✓ CSV | After MVP (phase 4) | Export / print (D), Reports + labels (11) | ✓ |
| **Archive contents** (ZIP, RAR, 7z, ISO) | ✓ | ✓ | – | ✓ | **Phase 3b**, for new scans and re-scans | Scan wizard (7) option → search and explorer | ✓ |
| **EXIF / ID3 / video info** | ✓ | ✓ | – | – | **Phase 3b**, for new scans and re-scans | Scan wizard (7) option → drawer (B), search filters | ✓ |
| **Thumbnails** | ✓ | ✓ | – | – | **Phase 3b**, opt-in per disc | Explorer grid view (6), drawer (B) | ✓ |
| AI image search | ✓ | – | – | – | **Not planned**. Possible later on-device (§7.00) | – | – |

**Legacy data note:** the 311 imported discs only have names, sizes and dates. Archive
contents, EXIF/ID3 and thumbnails exist only for discs **scanned or re-scanned with the new
app**, and the scan wizard offers "Re-scan with details" for exactly that.

### 7.00 Deep scan design (archives, media details, thumbnails)
All of this happens **inside the browser during a scan**, works offline, and stays within the free tier.

| Detail | How it's read | Where it's stored | Cost |
|---|---|---|---|
| **ZIP contents** | `zip.js` reads only the central directory at the end of the file, not the whole archive | Rows in `file` with `container_file_id` pointing at the archive, so they are searchable and browsable like a folder | Tiny, same as normal file rows |
| **7z / RAR / ISO contents** | `libarchive.js` (WASM) lists entries without extracting | Same as ZIP | Reading is slower for large archives, so it's a separate checkbox |
| **Photo EXIF** (camera, taken date, resolution, GPS on/off) | `exifr` reads only the first few KB of each image | `file.meta` JSON. Taken date and camera also go into the search index. | ~100 bytes per image |
| **Audio ID3** (artist, album, title, duration) | `music-metadata` (browser build) reads the tags only | `file.meta`. Artist, album and title go into the search index, so you can search "Coldplay" | ~150 bytes per track |
| **Video info** (duration, resolution, codec) | `mediainfo.js` (WASM) reads headers only | `file.meta` | ~100 bytes per video |
| **Thumbnails** | Canvas / `createImageBitmap` → 96 px WebP, ~3 KB | **Local only by default** (OPFS on the scanning device). Opt-in per disc to sync as a separate "thumb pack" in KV. | 35K images × 3 KB ≈ 100 MB, which is 10% of free KV. The wizard shows the estimate before you confirm. |
| **AI image search** (not planned) | Could run CLIP on-device with `transformers.js` during the scan, which is free and offline | Embedding vectors in a local table | Heavy for large image discs, so it stays out of scope for now |

Pack format `v: 2` adds `container`, `meta` and `thumb` columns. Because packs list their
own columns (§8.3), older app versions just ignore them.

There are **14 screens** and **6 overlays**. The MVP needs **9 screens**.

```
/login                     1  Sign in
/setup                     2  First-time setup (download catalog)
/                          3  Dashboard
/search?q=&cat=&disc=…     4  Search
/discs                     5  Disc library
/discs/:no[/browse/*path]  6  Disc explorer (tabs: Browse · Overview · Activity)
/scan                      7  Add / re-scan disc (wizard)
/sync                      8  Sync & storage
/settings/*                9  Settings
── After MVP ──────────────────────────────────────────
/duplicates               10  Duplicate finder
/stats                    11  Statistics & reports
/collections[/:id]        12  Collections, tags & saved searches
/locations                13  Locations & loans
/health                   14  Data health
── Overlays ──────────────────────────────────────────
  A ⌘K command palette    B item detail drawer    C edit disc
  D export / print        E confirm (destructive) F conflict resolver
```

**App shell on every screen**: top bar with search, "+ Add disc", **sync indicator**, and user
menu. Left nav on desktop, bottom tab bar on phones. Wide screens use 3 panes (tree, list,
detail).

### 1. Sign in
- **Continue with GitHub / Google**, or a passkey once one is registered. No passwords, because hashing them doesn't fit the Free plan's 10 ms CPU limit. Needs internet the first time.
- On later launches with a saved session, the app skips this screen and opens even when offline.
- Optional **app lock** (PIN or device biometrics through a passkey) for shared computers.

### 2. First-time setup
- Steps: **Request storage → Download catalog (x of 311 discs, MB) → Build search index → Done**.
- Shows storage needed vs. available, and warns if space is low.
- Prompts to install the app (with iOS-specific instructions).
- If the connection drops, setup resumes where it stopped.

### 3. Dashboard
- Large search box, focused when the page opens.
- Stat cards: discs, folders, files, total size, on loan, **pending changes**.
- Recently added or re-scanned discs, recent searches, pinned saved searches.
- Mini charts: files by category, storage by media type.
- Health alerts, for example "10 missing disc numbers · 1 empty disc · 396 bad dates".

### 4. Search (the most important screen)
- **Query**: substring match ("helsing" finds `VanHelsing2004…`), `"exact"`, `-exclude`, `ext:mkv`, `disc:116`, `size:>1gb`, `year:2010`, `tag:movies`. Results update as you type (debounced, local).
- **Scope**: Files · Folders · Both.
- **Filters**: category chips, extension (with counts), disc range, location, size range with unit picker, date range with "hide unknown dates", tags, disc status.
- **Results**: virtualized table with Name (matched text highlighted), **Disc # badge + location slot**, path, size, type, date.
- **Group by disc**, which answers "which discs do I need to pull out?".
- Sort, multi-select, bulk tag or add to collection, export selection, save search.
- All filter state is in the URL, so searches can be bookmarked and shared.

### 5. Disc library
- Table or grid view. Columns: Disc #, title, media type, files, folders, size, % full, location, status, tags, date added, last scanned, **sync status**.
- Filters and sort on every column. **Jump to disc #**.
- Missing disc numbers appear as greyed-out rows with "Mark retired / lost".
- Bulk actions: assign location, set status, tag, export, print labels.

### 6. Disc explorer
- **Header**: Disc #, title, media type, capacity bar, location, status, tags. Buttons: Edit (C), Re-scan (7), Export (D), Delete (E).
- **Browse tab**: lazy folder tree, folder contents with breadcrumb, filter, sort, and a detail pane (B). The URL follows the current folder.
- **Overview tab**: category breakdown, largest files, extension table, date range, notes (markdown).
- **Activity tab**: scan history, loan history, edit history.

### 7. Add / re-scan disc (wizard, works offline)
1. **Disc info**: number (suggests the next free number or a missing gap), title, media type, location, tags.
2. **Pick folder**: the mounted disc drive. By default only file names, sizes and dates are read. Optional **deep scan** checkboxes: ZIP contents, 7z/RAR/ISO contents, photo/audio/video details, thumbnails (with a size estimate). See §7.00.
3. **Preview**: counts, size vs. media capacity, first 200 rows, warnings (bad dates, files over 4 GB).
4. **Re-scan diff**: added, removed and changed files. Tags and notes on files that still exist are kept.
5. **Save**: written to the local DB right away, and the pack is queued for upload. Shows "Pending upload" until synced.

### 8. Sync & storage
- **Status**: online or offline, last successful sync, server `seq` vs. local `seq`, "Sync now".
- **Pending changes**: outbox list (what, when, retries), with retry or discard for each entry.
- **Conflicts**: opens the resolver (F).
- **History**: recent changes pulled from other devices, and values that lost a conflict.
- **Storage**: space used by the local DB vs. quota, whether storage is persistent, "Rebuild search index", "Re-download catalog", "Wipe this device".
- **Devices**: devices signed in to this account, with last seen time and a revoke button.
- **Usage**: this device's API calls today and when the daily free limits reset.
- **Backups**: last nightly GitHub backup time, D1 Time Travel restore point (7 days), and **"Export full backup from this device"** (a zip of the local SQLite file, which also works offline).

### 9. Settings
- **Profile**: name, linked GitHub/Google account, passkeys, sessions.
- **Preferences**: theme, size units (binary or decimal), date format, default search scope, show or hide drive letter, sync interval, **Lite mode** (smaller search index for phones), **Local-only mode** (sync off), "sync only on Wi-Fi" when available.
- **Categories**: map extensions to categories, with a list of unmapped extensions sorted by count.
- **Import / export**: legacy import (admin), full export as CSV zip or SQLite file.
- **Users & roles** (if shared): Owner, Editor, Viewer.

### 10. Duplicate finder (after MVP, phase 4)
- **Match on**: name + size (default), name, size, or name + size + date. Files or folders.
- **Scope**: all discs, a range, or a tag. Minimum size defaults to 1 MB.
- **Results**: groups sorted by wasted space. Expanding a group shows each copy with disc #, location and path. Mark a keeper, tag the others, export the list.

### 11. Statistics & reports (after MVP, phase 4)
- **Charts**: size by category, top extensions, files by year, disc fill levels, discs added per year, largest files and folders.
- **Reports**: disc inventory, contents of one disc, "what's in Box 3", overdue loans. Output as CSV, HTML or print.
- **Print labels** with a QR code that opens `/discs/:no` in the installed app.

### 12. Collections, tags & saved searches (after MVP, phase 4)
- **Collections**: virtual folders mixing discs, folders and files, which can be nested.
- **Saved searches**: smart folders whose results update as data changes, pinnable to the dashboard.
- **Tag manager**: rename, merge, colour, delete, usage count.

### 13. Locations & loans (after MVP, phase 4)
- **Locations**: a tree (Room → Shelf → Box/Binder → Slot) with capacity and fill level. Drag discs between them, or bulk assign a range of disc numbers.
- **Loans**: borrowers, active, overdue and history. Loaned discs show a hand icon everywhere and a warning in search results.

### 14. Data health (after MVP, phase 4)
- Missing disc numbers, empty discs, invalid dates, extensions without a category, discs never re-scanned.
- Local consistency checks (search index row counts, orphaned item keys), each with a Fix button.

### Overlays
- **A. ⌘K palette**: quick file, folder and disc results, plus commands ("Go to disc 116", "Add disc", "Sync now").
- **B. Item drawer**: **disc # + location shown large**, full path with copy button, size, date, parent folder, **copies on other discs**, tags, collections, notes.
- **C. Edit disc**: title, media type, location + slot, status, condition, tags, notes.
- **D. Export / print**: format, columns, scope.
- **E. Confirm**: destructive actions require typing the disc number.
- **F. Conflict resolver**: "yours vs. theirs" for each field, with keep mine, keep theirs, or renumber.

---

## 8. Database design

### 8.1 Local database (SQLite WASM, on each device)
```sql
-- ── Lookup tables (future-proof: add rows, never rebuild tables for new kinds) ──
-- Seeded by the app and synced like other metadata, so new values reach every device.
CREATE TABLE media_type    (code TEXT PRIMARY KEY, label TEXT NOT NULL, capacity_kb INTEGER, sort_order INTEGER);
    -- 'CD' 700MB · 'DVD5' 4.7GB · 'DVD9' 8.5GB · 'BD25' · 'BD50' · later: 'BDXL', 'USB', 'HDD', 'LTO' …
CREATE TABLE disc_status   (code TEXT PRIMARY KEY, label TEXT NOT NULL);   -- available, on_loan, damaged, lost, retired
CREATE TABLE location_kind (code TEXT PRIMARY KEY, label TEXT NOT NULL);   -- room, shelf, box, binder, wallet
CREATE TABLE category      (code TEXT PRIMARY KEY, label TEXT NOT NULL, icon TEXT);  -- video, audio, image …

-- ── Catalog data (filled from disc packs) ─────────────────────────────
CREATE TABLE disc (
    disc_no        INTEGER PRIMARY KEY,            -- physical label number, no upper limit
    label          TEXT,                           -- optional display label: '12A', 'Blu-ray 3'
    title          TEXT,
    media_type     TEXT REFERENCES media_type(code),
    status         TEXT NOT NULL DEFAULT 'available' REFERENCES disc_status(code),
    location_id    TEXT REFERENCES location(id) ON DELETE SET NULL,
    location_slot  TEXT,
    notes          TEXT,
    meta           TEXT,                           -- JSON for future fields (no migration needed)
    folder_count   INTEGER NOT NULL DEFAULT 0,
    file_count     INTEGER NOT NULL DEFAULT 0,
    total_kb       INTEGER NOT NULL DEFAULT 0,
    pack_hash      TEXT,                           -- which pack is loaded locally
    pack_parts     INTEGER NOT NULL DEFAULT 1,
    pack_version   INTEGER NOT NULL DEFAULT 1,     -- pack format `v` it was built with
    scanned_at     TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,                           -- tombstone
    version        INTEGER NOT NULL DEFAULT 0      -- server version (for sync)
);

CREATE TABLE folder (
    folder_id   INTEGER PRIMARY KEY,               -- local only, never synced
    disc_no     INTEGER NOT NULL REFERENCES disc(disc_no) ON DELETE CASCADE,
    parent_id   INTEGER REFERENCES folder(folder_id) ON DELETE CASCADE,  -- NULL = disc root
    name        TEXT NOT NULL,
    rel_path    TEXT NOT NULL,                     -- 'Movies\Constantine' (no drive letter)
    size_kb     INTEGER,
    created     TEXT,
    meta        TEXT                               -- JSON, future
);
CREATE INDEX folder_tree_idx ON folder (disc_no, parent_id, name COLLATE NOCASE);
CREATE UNIQUE INDEX folder_path_idx ON folder (disc_no, rel_path COLLATE NOCASE);

CREATE TABLE file (
    file_id     INTEGER PRIMARY KEY,               -- local only
    disc_no     INTEGER NOT NULL REFERENCES disc(disc_no) ON DELETE CASCADE,
    folder_id   INTEGER REFERENCES folder(folder_id) ON DELETE CASCADE,  -- NULL = disc root
    container_file_id INTEGER REFERENCES file(file_id) ON DELETE CASCADE, -- set when inside a ZIP/RAR/ISO
    name        TEXT NOT NULL,
    ext         TEXT,                              -- lower-cased, '' → NULL
    rel_path    TEXT NOT NULL,
    size_kb     INTEGER,
    created     TEXT,
    date_valid  INTEGER NOT NULL DEFAULT 1,
    meta        TEXT                               -- JSON, future: md5, duration, EXIF, ID3 …
);
CREATE INDEX file_list_idx ON file (disc_no, folder_id, name COLLATE NOCASE);
CREATE INDEX file_ext_idx  ON file (ext);
CREATE INDEX file_container_idx ON file (container_file_id) WHERE container_file_id IS NOT NULL;
CREATE INDEX file_size_idx ON file (size_kb);
CREATE INDEX file_dup_idx  ON file (size_kb, name COLLATE NOCASE);
CREATE UNIQUE INDEX file_path_idx ON file (disc_no, rel_path COLLATE NOCASE);

-- Substring search ("helsing" → "VanHelsing2004[DvdRip]…"); rebuilt per disc on pack import
CREATE VIRTUAL TABLE file_fts   USING fts5(name, content='file',   content_rowid='file_id',   tokenize='trigram');
CREATE VIRTUAL TABLE folder_fts USING fts5(name, content='folder', content_rowid='folder_id', tokenize='trigram');

-- ── User metadata (synced row-by-row; UUIDv7 ids) ─────────────────────
-- Every table below also has: updated_at TEXT, deleted_at TEXT, version INTEGER
CREATE TABLE location   (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES location(id), name TEXT NOT NULL,
                         kind TEXT NOT NULL REFERENCES location_kind(code), capacity INTEGER, sort_order INTEGER DEFAULT 0, …);
CREATE TABLE tag        (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, color TEXT, …);
CREATE TABLE tag_link   (id TEXT PRIMARY KEY, tag_id TEXT NOT NULL REFERENCES tag(id),
                         item_key TEXT NOT NULL, …);            -- 'd:116' | 'p:116:path' | 'f:116:path'
CREATE TABLE collection (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES collection(id),
                         name TEXT NOT NULL, description TEXT, …);
CREATE TABLE collection_item (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collection(id),
                         item_key TEXT NOT NULL, …);
CREATE TABLE item_note  (item_key TEXT PRIMARY KEY, body TEXT NOT NULL, …);
CREATE TABLE saved_search (id TEXT PRIMARY KEY, name TEXT NOT NULL, query_json TEXT NOT NULL,
                         pinned INTEGER DEFAULT 0, …);
CREATE TABLE borrower   (id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT, …);
CREATE TABLE loan       (id TEXT PRIMARY KEY, disc_no INTEGER NOT NULL REFERENCES disc(disc_no),
                         borrower_id TEXT NOT NULL REFERENCES borrower(id),
                         loaned_at TEXT NOT NULL, due_at TEXT, returned_at TEXT, …);
CREATE TABLE category_override (ext TEXT PRIMARY KEY, category TEXT NOT NULL REFERENCES category(code), …);
CREATE INDEX tag_link_item_idx        ON tag_link (item_key);
CREATE INDEX collection_item_item_idx ON collection_item (item_key);

-- ── Local-only tables (never synced) ──────────────────────────────────
CREATE TABLE file_category (ext TEXT PRIMARY KEY, category TEXT NOT NULL REFERENCES category(code));  -- shipped defaults
CREATE TABLE search_history (id INTEGER PRIMARY KEY, query_json TEXT, result_count INTEGER, at TEXT);
CREATE TABLE stats_cache    (key TEXT PRIMARY KEY, value_json TEXT, refreshed_at TEXT);
CREATE TABLE dup_cache      (match_key TEXT, file_id INTEGER, copies INTEGER, wasted_kb INTEGER);

-- ── Sync engine ───────────────────────────────────────────────────────
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);   -- device_id, last_seq, last_sync_at, schema_ver
CREATE TABLE outbox (
    id          TEXT PRIMARY KEY,          -- UUIDv7 = idempotency key
    kind        TEXT NOT NULL CHECK (kind IN ('row','pack')),
    table_name  TEXT,  row_id TEXT,
    op          TEXT NOT NULL CHECK (op IN ('upsert','delete','pack_commit')),
    payload     TEXT NOT NULL,             -- changed fields + base_version, or pack meta
    blob_path   TEXT,                      -- OPFS path of a pending pack
    created_at  TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT
);
CREATE TABLE conflict (id TEXT PRIMARY KEY, outbox_id TEXT, table_name TEXT, row_id TEXT,
                       mine_json TEXT, theirs_json TEXT, created_at TEXT);
```

### 8.2 Server database (Cloudflare D1)
The server stores **no folder or file rows**. Those exist only in KV packs.
```sql
-- Better Auth: user, session, account, verification, passkey
CREATE TABLE device (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id),
                     name TEXT, last_seen_at TEXT, revoked_at TEXT);

-- Same metadata tables as the client (disc, location, tag, tag_link, collection,
-- collection_item, item_note, saved_search, borrower, loan, category_override)
-- plus, on disc:  pack_hash TEXT, pack_parts INTEGER, pack_bytes INTEGER, prev_pack_hash TEXT

CREATE TABLE change_log (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,   -- global, monotonic
    table_name  TEXT NOT NULL,
    row_id      TEXT NOT NULL,
    op          TEXT NOT NULL,                        -- upsert | delete | pack_commit
    row_json    TEXT,                                 -- full row after change
    overwritten_json TEXT,                            -- losing values (conflict audit)
    user_id     TEXT, device_id TEXT,
    outbox_id   TEXT UNIQUE,                          -- idempotency
    at          TEXT NOT NULL
);
CREATE INDEX change_log_row_idx ON change_log (table_name, row_id);

CREATE TABLE scan_job (id TEXT PRIMARY KEY, disc_no INTEGER, source TEXT, pack_hash TEXT,
                       files_added INTEGER, files_removed INTEGER, files_changed INTEGER,
                       device_id TEXT, at TEXT);
```

### 8.3 Disc pack format (KV key `pack:{disc_no}:{sha256}:{part}`, gzipped JSON)
```json
{
  "v": 1, "disc_no": 116, "part": 1, "parts": 1, "scanned_at": "2010-07-16T00:00:00Z",
  "folder_cols": ["id", "parent", "name", "size_kb", "created"],
  "folders": [[1, null, "Constantine", 2088378, "2009-05-13T02:23:16"]],
  "file_cols":   ["folder", "name", "size_kb", "created"],
  "files":   [[1, "Constantine.avi", 734512, "2009-05-13T02:20:01"]]
}
```
- Rows are arrays rather than objects to keep the file small. Folder IDs are local to the pack, and `parent`/`folder` refer to them. `rel_path` and `ext` are rebuilt on import, not stored.
- **Column lists are included in the pack**, so a future `v: 2` can add columns (for example `"md5"`, `"meta"`) and older importers simply ignore ones they don't know.
- Parts are cut at about 2 MB gzipped. A part never splits a folder's files across parts, and part 1 contains all folders.
- The KV key includes the content hash, so a part is downloaded once and cached forever.

### 8.4 Relationships
```
location (tree) ─< disc >─ loan >─ borrower
                    ├─< folder (tree) ─< file ──(ext)── file_category / category_override
                    │                     └── file_fts / folder_fts
                    └── pack parts in KV (by pack_hash)
tag ─< tag_link ──item_key──► disc | folder | file
collection (tree) ─< collection_item ──item_key──► disc | folder | file
item_note ──item_key──► disc | folder | file
outbox / conflict / sync_state   (device only)      change_log / device / scan_job (server only)
```

### 8.5 Key local queries
```sql
-- Search files (substring, filtered, grouped-by-disc capable)
SELECT f.file_id, f.name, f.disc_no, f.size_kb, f.ext, f.created, f.rel_path,
       d.title, l.name AS location, d.location_slot, d.status
FROM file_fts s
JOIN file f      ON f.file_id = s.rowid
JOIN disc d      ON d.disc_no = f.disc_no AND d.deleted_at IS NULL
LEFT JOIN location l ON l.id = d.location_id
LEFT JOIN file_category c ON c.ext = f.ext
WHERE s.name MATCH :q
  AND (:cat IS NULL OR coalesce((SELECT category FROM category_override o WHERE o.ext = f.ext), c.category) = :cat)
  AND (:min_kb IS NULL OR f.size_kb >= :min_kb)
  AND (:disc_from IS NULL OR f.disc_no BETWEEN :disc_from AND :disc_to)
ORDER BY rank
LIMIT 200 OFFSET :offset;

-- Lazy folder tree
SELECT folder_id, name, size_kb,
       EXISTS (SELECT 1 FROM folder c WHERE c.parent_id = f.folder_id) AS has_children
FROM folder f
WHERE f.disc_no = :disc_no AND f.parent_id IS :parent
ORDER BY name COLLATE NOCASE;
```

---

## 9. API (Cloudflare Worker)

| Method & path | Purpose |
|---|---|
| `POST /auth/*` | Better Auth: sign in, passkeys, refresh session |
| `GET /sync/head` | `{seq, protocol}`. Reads 1 row and is the cheap poll. |
| `GET /sync/manifest` | `{seq, discs: [{disc_no, pack_hash, parts, bytes, version}]}`. Used only during setup. |
| `GET /sync/changes?since=seq&limit=1000` | Row upserts and tombstones after `seq`, paged |
| `POST /sync/push` | Batch of outbox entries. Returns applied versions and conflicts. |
| `PUT /packs/:disc/:hash/:part` | Upload one pack part (≤ 2 MB), streamed into KV. The server checks the hash. |
| `GET /packs/:disc/:hash/:part` | Download one part, streamed from KV with `Cache-Control: immutable`. |
| `GET /usage` | Approximate usage today vs. free limits, shown on the Sync screen |
| `GET /devices` · `DELETE /devices/:id` | Manage devices |

**Daily Worker cron** (1 of 5 free): a single `DELETE FROM change_log WHERE at < now-90d LIMIT 5000`,
plus removal of pack parts that were replaced more than 30 days ago. A device offline for longer
than 90 days re-downloads its metadata; packs are unaffected.

**Nightly GitHub Actions backup** (free): `wrangler d1 export` → `metadata.sql`, plus any new pack
parts, committed to a private `discvault-backup` repo. The commit history is the backup history.
Restoring means `wrangler d1 execute --file` and re-uploading packs, or pointing the app at a new
backend (§4.4).

---

## 10. Repository layout
```
DiscVault/
├── apps/
│   ├── web/                     # Vite + React PWA
│   │   ├── src/routes/          # TanStack Router file routes (login, setup, index, search, discs.$no…)
│   │   ├── src/components/      # shell, data-table, folder-tree, item-drawer, command-palette, sync-indicator
│   │   ├── src/db/              # worker.ts (SQLite WASM + OPFS), rpc.ts, migrations/, queries/
│   │   ├── src/sync/            # bootstrap.ts, pull.ts, push.ts, packs.ts, conflicts.ts, leader-lock.ts
│   │   ├── src/scan/            # scan.worker.ts (folder walk → pack), diff.ts
│   │   └── src/sw.ts            # service worker (Workbox)
│   └── api/                     # Cloudflare Worker (Hono) + wrangler.toml (static assets, D1, KV, 1 cron)
├── .github/workflows/backup.yml # nightly: wrangler d1 export + new packs → private backup repo
├── packages/
│   ├── schema/                  # Drizzle tables shared by client + D1, Zod models, pack format types
│   └── sync-protocol/           # request/response types, item_key helpers, UUIDv7
├── tools/
│   └── import-legacy/           # dvd_manager.mdb → 311 packs + metadata seed → upload
└── dvd_manager.mdb              # original source data
```

---

## 11. Delivery plan

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Spike (1 week)** | Load the real 345K rows into SQLite WASM + OPFS on Chrome, Safari (iOS) and Firefox. Measure first sync, index build and search time. Deploy a hello-world Worker + D1 + KV on a Cloudflare account **with no payment method**, and confirm every binding works and 10 ms CPU is enough for push and pack streaming. | Search stays under ~50 ms on a mid-range phone, the DB survives a browser restart, and nothing in the stack asks for a card. |
| **1. Local core** | Monorepo, schemas, legacy import → packs, local DB worker, PWA shell, screens 3–6 + A, B, C | App installs, loads the catalog from local packs, and search and browse work with the network off. |
| **2. Sync** | API, auth, bootstrap, pack sync, outbox push/pull, limit handling (429 → paused), GitHub backup workflow, screens 1, 2, 8, 9, F | Two devices edit offline, reconnect, and end up the same. A simulated daily-limit error pauses sync without breaking the app. Playwright offline tests pass. |
| **3. Scanning** | Scan wizard + re-scan diff (7), offline pack upload, multi-part packs | A new disc scanned offline on a laptop appears on a phone after syncing. A synthetic 500K-file scan imports in parts. |
| **3b. Deep scan** | Archive contents, EXIF/ID3/video details, local thumbnails, opt-in thumb packs, pack `v: 2` | Re-scanning a disc makes files inside ZIPs searchable and lets you search music by artist, all offline. |
| **4. Organize & analyse** | Screens 10–14, D, E, print labels, Lite mode, local-only mode | Feature complete. Load test with a synthetic 2,500-disc catalog. |

---

### Sources
- [Official SQLite WASM: persistence options (OPFS, SAH pool)](https://sqlite.org/wasm/doc/trunk/persistence.md) · [SQLite WASM + OPFS (Chrome for Developers)](https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system)
- Free-tier limits: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 free-tier limit enforcement (Sept 2026)](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) · [KV limits](https://developers.cloudflare.com/kv/platform/limits/) · [R2 requires a payment method (Cloudflare Community)](https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179)
- Alternatives considered: [PowerSync full-text search](https://docs.powersync.com/client-sdks/full-text-search), [PowerSync pricing](https://powersync.com/pricing), [PowerSync Open Edition](https://www.powersync.com/blog/new-open-era-for-powersync), [Turso sync for browser (alpha)](https://www.npmjs.com/package/@tursodatabase/sync-browser)
- Deep-scan libraries: [zip.js](https://gildas-lormeau.github.io/zip.js/) · [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) · [exifr](https://github.com/MikeKovarik/exifr) · [music-metadata](https://github.com/Borewit/music-metadata) · [mediainfo.js](https://github.com/buzz/mediainfo.js)
- Feature research: [WinCatalog features](https://www.wincatalog.com/features.html), [NeoFinder find duplicates](https://www.cdfinder.de/guide/5/5.3/find_duplicates.html), [catcli](https://github.com/deadc0de6/catcli)
