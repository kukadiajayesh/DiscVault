-- DiscVault schema (SQLite / libSQL-Turso compatible)
-- Source: dvd_manager.mdb (MS Access), migrated via mdb-tools.
--
-- Note: the source data used `0` as a sentinel for "no parent" (files sitting
-- at a disc's root have dir_id=0; top-level folders have parent_dir_id=0),
-- but no dir_id=0 row actually exists in dir_master. That sentinel is
-- normalized to NULL here (see migrate.sh) so it means what it says — "no
-- parent" — and so the foreign keys below validate instead of reporting 1700+
-- false "orphan" violations on every import.

PRAGMA foreign_keys = ON;

CREATE TABLE cd_master (
    cd_no       INTEGER PRIMARY KEY,
    entry_date  DATETIME NOT NULL
);

CREATE TABLE dir_master (
    dir_id          INTEGER PRIMARY KEY,
    cd_no           INTEGER NOT NULL REFERENCES cd_master(cd_no) ON DELETE CASCADE,
    dir_name        TEXT NOT NULL,
    dir_created     DATETIME,
    dir_length      INTEGER,
    parent_dir_id   INTEGER REFERENCES dir_master(dir_id) ON DELETE CASCADE,
    comment         TEXT,
    full_path       TEXT NOT NULL,
    dir_size_type   TEXT,
    entry_date      DATETIME
);

CREATE INDEX dir_master_cd_no_idx         ON dir_master (cd_no);
CREATE INDEX dir_master_parent_dir_id_idx ON dir_master (parent_dir_id);

CREATE TABLE file_master (
    file_id         INTEGER PRIMARY KEY,
    dir_id          INTEGER REFERENCES dir_master(dir_id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    file_type       TEXT,
    file_created    DATETIME,
    file_length     INTEGER,
    file_size_type  TEXT,
    full_path       TEXT NOT NULL,
    cd_no           INTEGER NOT NULL REFERENCES cd_master(cd_no) ON DELETE CASCADE
);

CREATE INDEX file_master_dir_id_idx ON file_master (dir_id);
CREATE INDEX file_master_cd_no_idx  ON file_master (cd_no);

-- Full-text search (external-content FTS5, kept in sync via triggers below)
CREATE VIRTUAL TABLE file_search USING fts5(
    file_name, full_path,
    content='file_master', content_rowid='file_id'
);

CREATE VIRTUAL TABLE dir_search USING fts5(
    dir_name, full_path,
    content='dir_master', content_rowid='dir_id'
);

CREATE TRIGGER file_master_ai AFTER INSERT ON file_master BEGIN
    INSERT INTO file_search(rowid, file_name, full_path)
    VALUES (new.file_id, new.file_name, new.full_path);
END;

CREATE TRIGGER file_master_ad AFTER DELETE ON file_master BEGIN
    INSERT INTO file_search(file_search, rowid, file_name, full_path)
    VALUES ('delete', old.file_id, old.file_name, old.full_path);
END;

CREATE TRIGGER file_master_au AFTER UPDATE ON file_master BEGIN
    INSERT INTO file_search(file_search, rowid, file_name, full_path)
    VALUES ('delete', old.file_id, old.file_name, old.full_path);
    INSERT INTO file_search(rowid, file_name, full_path)
    VALUES (new.file_id, new.file_name, new.full_path);
END;

CREATE TRIGGER dir_master_ai AFTER INSERT ON dir_master BEGIN
    INSERT INTO dir_search(rowid, dir_name, full_path)
    VALUES (new.dir_id, new.dir_name, new.full_path);
END;

CREATE TRIGGER dir_master_ad AFTER DELETE ON dir_master BEGIN
    INSERT INTO dir_search(dir_search, rowid, dir_name, full_path)
    VALUES ('delete', old.dir_id, old.dir_name, old.full_path);
END;

CREATE TRIGGER dir_master_au AFTER UPDATE ON dir_master BEGIN
    INSERT INTO dir_search(dir_search, rowid, dir_name, full_path)
    VALUES ('delete', old.dir_id, old.dir_name, old.full_path);
    INSERT INTO dir_search(rowid, dir_name, full_path)
    VALUES (new.dir_id, new.dir_name, new.full_path);
END;
