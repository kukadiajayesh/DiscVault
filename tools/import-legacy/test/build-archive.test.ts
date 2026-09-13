import { nodeSqlDb } from "@discvault/schema/node";
import { ArchiveManifest, archivePackPath, parsePackPart } from "@discvault/sync-protocol";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildLegacyArchive } from "../src/build-archive.js";

function legacyDb() {
  const db = nodeSqlDb();
  db.exec(`
    CREATE TABLE cd_master (cd_no INTEGER PRIMARY KEY, entry_date DATETIME NOT NULL);
    CREATE TABLE dir_master (dir_id INTEGER PRIMARY KEY, cd_no INTEGER, dir_name TEXT, dir_created DATETIME,
      dir_length INTEGER, parent_dir_id INTEGER, comment TEXT, full_path TEXT, dir_size_type TEXT, entry_date DATETIME);
    CREATE TABLE file_master (file_id INTEGER PRIMARY KEY, dir_id INTEGER, file_name TEXT, file_type TEXT,
      file_created DATETIME, file_length INTEGER, file_size_type TEXT, full_path TEXT, cd_no INTEGER);
    INSERT INTO cd_master VALUES (1, '2011-12-25 00:00:00'), (3, '2011-12-26 00:00:00');
    INSERT INTO dir_master VALUES
      (10, 1, 'Movies', '2009-05-13 02:23:16', 5000000, NULL, NULL, 'G:\\Movies', NULL, NULL),
      (11, 1, 'Constantine', '2009-05-13 02:23:16', 5000000, 10, NULL, 'G:\\Movies\\Constantine', NULL, NULL);
    INSERT INTO file_master VALUES
      (1, NULL, 'Autorun.inf', '.inf', '1900-01-00 00:00:00', 0, NULL, 'G:\\Autorun.inf', 1),
      (2, 11, 'Constantine.avi', '.avi', '2009-05-13 02:20:01', 5000000, NULL, 'G:\\Movies\\Constantine\\Constantine.avi', 1);
  `);
  return db;
}

describe("buildLegacyArchive", () => {
  it("builds a valid .dvault with one pack per disc", async () => {
    const { zip, report } = await buildLegacyArchive(legacyDb(), { builtAt: "2026-09-13T00:00:00Z" });
    expect(report).toMatchObject({
      discs: 2,
      folders: 2,
      files: 2,
      missingDiscNumbers: [2],
      emptyDiscs: [3],
      invalidFileDates: 1,
      mediaTypes: { DVD9: 1, DVD5: 1 },
    });

    const entries = unzipSync(zip);
    const manifest = ArchiveManifest.parse(JSON.parse(new TextDecoder().decode(entries["manifest.json"])));
    const disc1 = manifest.discs.find((d) => d.disc_no === 1);
    expect(disc1).toMatchObject({ media_type: "DVD9", scanned_at: "2011-12-25T00:00:00Z", file_count: 2 });

    const data = entries[archivePackPath(1, disc1?.pack_hash ?? "", 1)];
    expect(data).toBeDefined();
    const part = await parsePackPart(data ?? new Uint8Array());
    expect(part.folders.map((f) => [f.name, f.parent])).toEqual([
      ["Movies", null],
      ["Constantine", 1],
    ]);
    expect(part.files.find((f) => f.name === "Constantine.avi")?.folder).toBe(2);
  });
});
