# DiscVault: Claude Design prompts

Paste these into **one Claude Design project**, in order. Prompt 1 sets the product brief and
design system; the later prompts reuse them. Wait for each batch to finish and fix anything you
don't like before sending the next one. Source of truth: `WEB_APP_ARCHITECTURE.md` §3 and §8.

---

## Prompt 1: Brief, design system, app shell, screens 1–4

```
Design a web app called DiscVault. Treat this as a real product that will be built with
React + shadcn/ui (Radix) + Tailwind CSS v4 + lucide icons + cmdk, so use components and
patterns that map directly onto shadcn/ui (Button, Input, Table, Tabs, Sheet, Dialog, Command,
Badge, Card, Progress, Tooltip, DropdownMenu, Toast).

WHAT IT IS
DiscVault is a catalog of physical CD/DVD discs. People scanned the contents of their discs years
ago; the app answers one question instantly: "which physical disc holds this file, and where is
that disc?" Anyone signs in with Google and gets their own private catalog. It is an installable,
offline-first PWA: search and browsing always work with no internet, and changes sync later.

WHO USES IT
A person with a shelf of 300+ numbered discs in wallets and boxes, on a desktop (main use,
scanning discs) and a phone (quick lookups while standing at the shelf).

REAL DATA TO USE IN MOCKUPS (do not use lorem ipsum)
- Catalog: 311 discs (numbered 1–321), 42,841 folders, 345,216 files, 1.6 TB total.
- Media: 224 DVD-5 (4.7 GB), 86 DVD-9 (8.5 GB). Disc #185 is empty.
- Missing disc numbers: 2, 46, 114, 115, 158–161, 170, 177. 396 files have invalid dates.
- Example files: disc 116 "Movies/Constantine/Constantine.avi" 700 MB (2009-05-13);
  "VanHelsing2004[DvdRip].avi"; "Coldplay - Viva la Vida.mp3"; "Setup.exe"; "IMG_0412.JPG".
- Locations: "Living room › Shelf A › Wallet 1, page 5", "Box 3", "Binder Blue, slot 12".
- User: Alex Morgan, alex.morgan@gmail.com (Google avatar).
- ~5,500 likely duplicate groups. Catalog download is 5.0 MB; local database 109 MB.

VISUAL DIRECTION
- A calm, dense, fast utility, in the spirit of Linear, Raycast and Finder, not a marketing site.
- The disc number is the hero element: a bold, monospace, pill/badge ("#116") that appears
  everywhere a file appears, always paired with its physical location.
- Monospace (e.g. JetBrains Mono / Geist Mono) for paths, sizes and disc numbers; a clean sans
  (e.g. Inter / Geist) for everything else. Tabular numbers in tables.
- Neutral greys with one accent colour; semantic colours for sync state (synced green, syncing
  blue, offline grey, pending amber, conflict red) and file categories (video, audio, image,
  document, archive, software, other).
- Light and dark themes for every screen. Compact table rows (32–36 px). WCAG AA contrast,
  visible focus rings, full keyboard use.
- Show a small design-system sheet first: colours (light/dark), type scale, disc badge, category
  chips, sync indicator states, size/date formatting, table row, empty state, toast.

APP SHELL (every signed-in screen)
- Desktop (≥1280 px): left nav (Dashboard, Search, Discs, Add disc, Sync, Settings; after that a
  divider and Duplicates, Stats, Collections, Locations, Health), top bar with a global search
  field showing a ⌘K hint, "+ Add disc" button, sync indicator, user avatar menu.
- Wide screens use three panes where it helps: tree | list | detail.
- Phone (390 px): bottom tab bar (Home, Search, Discs, Sync, More), search at the top.
- Sync indicator states, always visible: "● Synced", "◐ Syncing…", "○ Offline",
  "▲ 3 changes pending", "⚠ 1 conflict". Items waiting to upload get a small "Pending" badge.
- Anything that needs internet is disabled when offline with a tooltip explaining why.

SCREENS IN THIS BATCH (desktop, light theme first, then dark)

1. Sign in (/login)
   - Only one sign-in option: a "Continue with Google" button that follows Google's branding
     guidelines. No password fields, no other providers.
   - Short value line ("Find any file on any disc, even offline"), a small illustration of a
     disc with a number badge, privacy line ("Your catalog is private to your Google account").
   - Variants: sign-ups invite-only ("DiscVault is invite-only right now"), full ("DiscVault is
     full"), and an account picker when two Google accounts have used this browser before.

2. First-time setup (/setup), two variants
   a. New account, empty catalog: welcome + two big choices, "Start empty (scan your first disc)"
      and "Import archive (.dvault file)".
   b. Existing account on a new device: stepper "Request storage → Download catalog → Build
      search index → Done", with "Downloading 184 of 311 discs · 3.1 of 5.0 MB", storage needed
      (109 MB) vs. available, a "Use Lite mode (79 MB)" suggestion, and an "Install the app" card
      with iOS instructions (Share → Add to Home Screen).

3. Dashboard (/)
   - Large, auto-focused search box.
   - Stat cards: Discs 311 · Folders 42,841 · Files 345,216 · Total 1.6 TB · On loan 4 ·
     Pending changes 3.
   - Recently added or re-scanned discs, recent searches, pinned saved searches.
   - Mini charts: files by category (bar), storage by media type (donut).
   - Health alert strip: "10 missing disc numbers · 1 empty disc · 396 invalid dates".

4. Search (/search?q=helsing), the most important screen
   - Query bar supporting operators; show chips parsed from "helsing ext:avi size:>500mb".
   - Scope toggle: Files · Folders · Both.
   - Left filter panel: category chips with counts, extension list with counts, disc range,
     location, size range with unit picker, date range with "Hide unknown dates", tags, status.
   - Virtualized results table: Name (with the matched text highlighted), Disc badge + location,
     Path (monospace, truncated in the middle), Size, Type, Date. Multi-select checkboxes with a
     bulk bar (Tag, Add to collection, Export, Save search).
   - "Group by disc" toggle: grouped view with one header per disc ("#116 · Wallet 1, page 5 ·
     4 matches") answering "which discs do I need to pull out?".
   - Result count and search time ("128 files · 12 ms · offline").
   - Also show: no results state, and a loan warning on a result whose disc is lent out.
```

---

## Prompt 2: Screens 5–9 and overlays A–C

```
Using the same DiscVault design system, shell and real data, design these desktop screens in
light and dark.

5. Disc library (/discs)
   - Toggle table / grid. Columns: Disc # badge, Title, Media type, Files, Folders, Size,
     % full (small capacity bar against 4.7 or 8.5 GB), Location, Status, Tags, Added, Last
     scanned, Sync status.
   - Column filters and sort, "Jump to disc #" input.
   - Missing numbers (e.g. #114, #115) appear as greyed placeholder rows with "Mark retired / lost".
   - Bulk actions: assign location, set status, tag, export, print labels.

6. Disc explorer (/discs/116/browse/Movies/Constantine)
   - Header: big "#116" badge, title, media type, capacity bar, location, status, tags; buttons
     Edit, Re-scan, Export, Delete.
   - Tabs: Browse · Overview · Activity.
   - Browse: lazy folder tree (with a "(disc root)" node) | folder contents with breadcrumb,
     filter and sort | detail pane for the selected file.
   - Overview: category breakdown, largest files, extension table, date range, markdown notes.
   - Activity: scan history, loan history, edit history timeline.

7. Add / re-scan disc wizard (/scan), a 5-step stepper, works offline
   1. Disc info: number (suggests "Next free: 322" and "Fill a gap: 2"), title, media type,
      location, tags.
   2. Pick folder: "Choose disc drive" button (Chrome) with fallback note for Safari/Firefox;
      optional deep-scan checkboxes: ZIP contents, 7z/RAR/ISO contents, photo/audio/video
      details, thumbnails ("≈ 14 MB for 4,800 images").
   3. Preview: counts, size vs. capacity bar, first rows, warnings (12 invalid dates, 1 file
      over 4 GB).
   4. Re-scan diff: added / removed / changed lists; "Tags and notes on 38 files kept".
   5. Saved: "Saved on this device · Pending upload" with the sync indicator.

8. Sync & storage (/sync)
   - Status card: online/offline, last sync "2 min ago", server seq vs local seq, "Sync now".
   - Pending changes list (what, when, retries) with retry/discard per row.
   - Conflicts entry point, and History of changes from other devices.
   - Storage: local DB 109 MB of quota, persistent storage on/off, "Rebuild search index",
     "Re-download catalog", "Sign out & wipe this device" (destructive).
   - Devices signed in to this account (MacBook Chrome, iPhone Safari) with last seen and Revoke.
   - Usage vs. this catalog's quotas: "Pack uploads today 12 / 400", "Metadata writes 86 /
     10,000", "Storage 5.0 / 50 MB", plus a paused banner variant: "Cloud sync paused until
     05:30 (daily free limit). Everything still works offline."
   - Backups: last nightly backup, 30-day restore window, "Export full backup (.dvault)".

9. Settings (/settings), left sub-nav
   - Account: Google name, email and avatar (read-only, "Managed by Google"), sessions,
     danger zone "Delete my account and catalog".
   - Preferences: theme, size units (binary/decimal), date format, default search scope, show
     drive letter, sync interval, Lite mode, Local-only mode, sync on Wi-Fi only.
   - Categories: extension → category mapping, with "Unmapped extensions" sorted by count.
   - Import & export: Import archive (.dvault, into your own catalog only), export as .dvault,
     CSV zip or SQLite file. Show the import flow: file picked → validation → preview (311 discs,
     42,841 folders, 345,216 files, 10 missing numbers, 396 invalid dates, 0 disc-number
     collisions) → progress "Importing locally 212 / 311" → "Uploading 140 of 311 packs".
   - Operator section (only for operator accounts): sign-up mode (Invite / Open / Closed), max
     users (100), invites list, shared free-tier usage meters. No access to other users' data.

OVERLAYS
A. ⌘K command palette: grouped results (Files, Folders, Discs) plus commands ("Go to disc 116",
   "Add disc", "Sync now"), keyboard hints.
B. Item detail drawer (right sheet): disc number + location shown very large at the top, full
   path with copy button, size, date, parent folder, "Copies on other discs" list, tags,
   collections, notes.
C. Edit disc dialog: title, media type, location + slot, status, condition, tags, notes.
```

---

## Prompt 3: After-MVP screens 10–14 and overlays D–F

```
Same DiscVault design system and data. Design these desktop screens in light and dark.

10. Duplicate finder (/duplicates): "Match on" (name + size default, name, size, name + size +
    date), files or folders, scope (all discs / range / tag), minimum size 1 MB. Groups sorted by
    wasted space ("Constantine.avi · 3 copies · 1.4 GB wasted"); expanding shows each copy with
    disc badge, location and path; mark keeper, tag others, export.
11. Statistics & reports (/stats): size by category, top extensions, files by year (skip invalid
    dates, note "396 unknown"), disc fill levels, discs added per year, largest files/folders.
    Reports list: disc inventory, contents of one disc, "What's in Box 3", overdue loans; output
    CSV / HTML / Print. Include a printable disc label sheet with a QR code per disc.
12. Collections, tags & saved searches (/collections): nested collections mixing discs, folders
    and files; saved searches as smart folders with live counts and a pin toggle; tag manager
    (rename, merge, colour, delete, usage count).
13. Locations & loans (/locations): location tree Room → Shelf → Box/Binder → Slot with capacity
    and fill bars; drag discs between them, bulk assign a disc-number range. Loans: borrowers,
    active, overdue (red), history. Lent discs show a hand icon.
14. Data health (/health): missing disc numbers, empty discs (#185), invalid dates (396),
    unmapped extensions, never re-scanned discs, local index consistency checks, each row with a
    Fix button.

OVERLAYS
D. Export / print dialog: format, columns, scope, preview.
E. Destructive confirm: user must type the disc number ("Type 116 to delete") or, for account
   deletion, their email.
F. Conflict resolver: per-field "Yours vs. Theirs" with Keep mine / Keep theirs, and the
   "Disc 322 already exists → Use 323 / Merge / Discard" case.
```

---

## Prompt 4: Phone layouts and states

```
Same DiscVault design system. Now design the phone versions (390 × 844) and the key states.

PHONE SCREENS: Sign in, Setup (download progress), Dashboard, Search with results and a filter
bottom sheet, Search grouped by disc, Item detail as a full-height sheet with the disc number and
location huge (the "standing at the shelf" view), Disc library list, Disc explorer (folder
drill-down instead of a tree), Sync & storage, Settings → Account.

STATES (show each on the most relevant screen, desktop or phone)
- Offline: grey "○ Offline" indicator, network-only actions disabled with explanation; search
  still working ("128 files · 9 ms · offline").
- Pending: "▲ 3 changes pending" with Pending badges on edited rows.
- Daily free limit reached: the paused banner with reset time; app otherwise normal.
- Conflict: "⚠ 1 conflict" indicator leading to the resolver.
- Empty catalog (new account): dashboard with "Scan your first disc" and "Import archive".
- Loading: skeleton rows for the explorer and first-time index build progress.
- Errors: import archive failed validation ("3 packs have wrong hashes"), session expired while
  offline ("Sign in with Google to send 3 pending changes. Nothing is lost.").
- Signed in with a second Google account on the same browser: account picker and a note that
  each account's catalog is kept separately on this device.
- "Update available → Reload" toast and the "Install DiscVault" prompt.
```
