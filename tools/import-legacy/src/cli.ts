#!/usr/bin/env -S npx tsx
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { nodeSqlDb } from "@discvault/schema/node";
import { buildLegacyArchive } from "./build-archive.js";

// folders: 42,840 raw dir_master rows minus 1 exact duplicate sibling entry deduped on import
// (dvd_manager.mdb disc 23 has two identical "fonat" rows under the same parent).
const LEGACY_COUNTS = { discs: 311, folders: 42_839, files: 345_215 };

const { values } = parseArgs({
  options: {
    in: { type: "string", default: "data/discvault.db" },
    out: { type: "string", default: "discvault-legacy.dvault" },
    "skip-count-check": { type: "boolean", default: false },
  },
});

// pnpm runs package scripts from the package directory; resolve paths from where the user ran it.
const cwd = process.env.INIT_CWD ?? process.cwd();
const input = path.resolve(cwd, values.in);
const output = path.resolve(cwd, values.out);

const db = nodeSqlDb(input);
console.log(`Reading ${input}`);
const { zip, report } = await buildLegacyArchive(db, {
  onProgress: (done, total) => {
    if (done % 25 === 0 || done === total) process.stdout.write(`\r  packs built: ${done} / ${total}`);
  },
});
db.close();
process.stdout.write("\n");

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`
Discs            ${report.discs}
Folders          ${report.folders}
Files            ${report.files}
Catalog size     ${(report.totalKb / 1024 / 1024 / 1024).toFixed(2)} TB
Packs (gzipped)  ${mb(report.packBytes)} · largest ${(report.largestPackBytes / 1024).toFixed(0)} KB · ${report.multiPartDiscs} multi-part
Media types      ${Object.entries(report.mediaTypes)
  .map(([k, v]) => `${k} ${v}`)
  .join(" · ")} (inferred from size)
Missing numbers  ${report.missingDiscNumbers.join(", ") || "none"}
Empty discs      ${report.emptyDiscs.join(", ") || "none"}
Invalid dates    ${report.invalidFileDates} files`);

if (!values["skip-count-check"]) {
  const actual = { discs: report.discs, folders: report.folders, files: report.files };
  if (JSON.stringify(actual) !== JSON.stringify(LEGACY_COUNTS)) {
    console.error(`\nCount check failed: expected ${JSON.stringify(LEGACY_COUNTS)}, got ${JSON.stringify(actual)}.`);
    console.error("Re-run data/migrate.sh, or pass --skip-count-check for a different catalog.");
    process.exit(1);
  }
}

writeFileSync(output, zip);
console.log(`\nWrote ${output} (${mb(zip.byteLength)}). Import it in DiscVault: Settings → Import & export → Import archive.`);
