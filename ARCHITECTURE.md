# DiscVault Architecture Plan

## Use case
Offline catalog for CD/DVD archives (311 discs, ~42.8K folders, ~345K files). Read/search
heavy — no concurrent writes, no server needed. Core feature is fast lookup of which
physical disc holds a file, by name, type, or path.

## Current data
`dvd_manager.mdb` (MS Access), 3 tables:
- `cd_master` (`cd_no` PK, `entry_date`) — 311 rows
- `dir_master` (`dir_id`, `cd_no` FK, `dir_name`, `full_path`, `parent_dir_id`, ...) — 42,841 rows
- `file_master` (`file_id`, `dir_id` FK, `file_name`, `full_path`, `cd_no` FK, ...) — 345,216 rows

## Target platforms
- Desktop: macOS, Windows, Linux — web-tech app
- Mobile: iOS/Android — Flutter

## Decision: split stack
- **Desktop**: Tauri 2.x (Rust shell) + React + TypeScript + Vite frontend.
  - Native webview per OS, ~10-15MB binaries, low RAM (no bundled Chromium).
  - DB access via `rusqlite` in Rust (Tauri commands); frontend calls `invoke()` and
    never touches SQLite directly — keeps large queries off the webview/JS thread.
  - React + TanStack Table/Virtual for virtualized rendering of large result sets.
- **Mobile**: Flutter (Dart) + `sqlite3`/`sqflite` reading the same SQLite file.

Two UI codebases (accepted tradeoff for using web skills on desktop), one shared
SQLite data layer — no schema duplication.

## Shared foundation (do first)
1. **Migrate `.mdb` → SQLite.** Access format isn't readable cross-platform without
   ODBC drivers unavailable on Linux/iOS/Android; SQLite opens natively in both
   Rust and Dart with zero server.
   ```
   mdb-export -I sqlite dvd_manager.mdb cd_master  > migrate.sql
   mdb-export -I sqlite dvd_manager.mdb dir_master >> migrate.sql
   mdb-export -I sqlite dvd_manager.mdb file_master >> migrate.sql
   sqlite3 discvault.db < migrate.sql
   ```
2. **Add indexes/FTS.** Original schema has FK indexes but no PKs on `dir_master`/
   `file_master`, and no full-text index:
   ```sql
   CREATE VIRTUAL TABLE file_search USING fts5(file_name, full_path, content='file_master', content_rowid='file_id');
   CREATE VIRTUAL TABLE dir_search  USING fts5(dir_name, full_path, content='dir_master', content_rowid='dir_id');
   ```
3. Both apps query the one `discvault.db` — single source of truth for data.

## Repo layout
```
DiscVault/
├── data/            # discvault.db (SQLite), migration script
├── desktop/         # Tauri app
│   ├── src-tauri/   # Rust: db queries, Tauri commands
│   └── src/         # React frontend
└── mobile/          # Flutter app
    └── lib/
```
