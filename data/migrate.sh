#!/usr/bin/env bash
# Migrates dvd_manager.mdb (MS Access) -> data/discvault.db (SQLite, Turso/libSQL-compatible).
# Requires: mdb-tools (mdb-export), sqlite3.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MDB_FILE="$ROOT_DIR/dvd_manager.mdb"
DB_FILE="$ROOT_DIR/data/discvault.db"
SCHEMA_FILE="$ROOT_DIR/data/schema.sql"

rm -f "$DB_FILE"

sqlite3 "$DB_FILE" < "$SCHEMA_FILE"

for table in cd_master dir_master file_master; do
    echo "Importing $table..."
    mdb-export -I sqlite "$MDB_FILE" "$table" | sqlite3 "$DB_FILE"
done

echo "Normalizing '0' root sentinels to NULL..."
sqlite3 "$DB_FILE" <<'SQL'
UPDATE file_master SET dir_id = NULL WHERE dir_id = 0;
UPDATE dir_master SET parent_dir_id = NULL WHERE parent_dir_id = 0;
SQL

echo "Verifying row counts..."
sqlite3 "$DB_FILE" <<'SQL'
SELECT 'cd_master',   COUNT(*) FROM cd_master;
SELECT 'dir_master',  COUNT(*) FROM dir_master;
SELECT 'file_master', COUNT(*) FROM file_master;
SELECT 'file_search', COUNT(*) FROM file_search;
SELECT 'dir_search',  COUNT(*) FROM dir_search;
SQL

echo "Checking foreign key integrity..."
sqlite3 "$DB_FILE" "PRAGMA foreign_key_check;"

echo "Done. -> $DB_FILE"
