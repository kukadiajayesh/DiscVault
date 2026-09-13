import { env } from "cloudflare:workers";
import { buildPack, uuidv7 } from "@discvault/sync-protocol";
import { describe, expect, it } from "vitest";
import { decideSignup, purgeDueKeys, setConfig } from "../../src/directory/directory.js";
import type { Env } from "../../src/env.js";
import { app, call, createUser, entry, type TestUser } from "./helpers.js";

async function uploadDisc(user: TestUser, discNo: number, fileName: string) {
  const deviceId = uuidv7();
  await call(user, "POST", "/sync/push", { deviceId, entries: [entry("disc", String(discNo), "upsert", { title: `Disc ${discNo}` })] });
  const pack = await buildPack({
    disc_no: discNo,
    scanned_at: null,
    built_at: new Date().toISOString(),
    folders: [{ id: 1, parent: null, name: "Movies", size_kb: 700, created: null }],
    files: [{ folder: 1, name: fileName, size_kb: 700, created: "2009-05-13 02:20:01" }],
  });
  const part = pack.parts[0];
  if (!part) throw new Error("no part");
  const reserve = await call(user, "POST", "/packs/reserve", {
    packs: [{ disc_no: discNo, pack_hash: pack.pack_hash, parts: [{ hash: part.hash, bytes: part.bytes }] }],
  });
  expect(((await reserve.json()) as { results: { status: string }[] }).results[0]?.status).toBe("reserved");
  const put = await call(user, "PUT", `/packs/${discNo}/${pack.pack_hash}/1`, part.data, { "Content-Type": "application/gzip" });
  expect(put.status).toBe(200);
  const commit = await call(user, "POST", "/sync/push", {
    deviceId,
    entries: [
      entry("disc", String(discNo), "pack_commit", {
        pack_hash: pack.pack_hash,
        pack_parts: 1,
        pack_bytes: part.bytes,
        pack_version: 1,
        folder_count: 1,
        file_count: 1,
        total_kb: 700,
        scanned_at: null,
      }),
    ],
  });
  expect(((await commit.json()) as { results: { status: string }[] }).results[0]?.status).toBe("applied");
  return { pack, part };
}

describe("request guards", () => {
  it("requires a session", async () => {
    expect((await call(null, "GET", "/sync/head")).status).toBe(401);
  });

  it("requires the protocol header on writes and rejects unknown versions", async () => {
    const user = await createUser("Guard");
    expect((await call(user, "POST", "/sync/push", {}, { "DV-Protocol": "" })).status).toBe(426);
    expect((await call(user, "GET", "/sync/head", undefined, { "DV-Protocol": "99" })).status).toBe(426);
    const noHeader = await app.fetch(
      new Request("http://localhost/api/sync/push", { method: "POST", headers: { "x-test-user": user.userId }, body: "{}" }),
      env,
    );
    expect(noHeader.status).toBe(400);
  });
});

describe("sync and packs", () => {
  it("syncs rows and serves packs for the owner", async () => {
    const alice = await createUser("Alice");
    const { pack, part } = await uploadDisc(alice, 116, "Constantine.avi");

    const head = (await (await call(alice, "GET", "/sync/head")).json()) as { seq: number };
    expect(head.seq).toBe(2);
    const changes = (await (await call(alice, "GET", "/sync/changes?since=0")).json()) as { changes: { row: { pack_hash: string } }[] };
    expect(changes.changes[0]?.row.pack_hash).toBe(pack.pack_hash);

    const download = await call(alice, "GET", `/packs/116/${pack.pack_hash}/1`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(part.data);
  });

  it("rejects a part whose bytes don't match the reservation", async () => {
    const bob = await createUser("Bob");
    const pack = await buildPack({
      disc_no: 1,
      scanned_at: null,
      built_at: new Date().toISOString(),
      folders: [],
      files: [{ folder: null, name: "a", size_kb: 1, created: null }],
    });
    const part = pack.parts[0];
    if (!part) throw new Error("no part");
    await call(bob, "POST", "/packs/reserve", {
      packs: [{ disc_no: 1, pack_hash: pack.pack_hash, parts: [{ hash: part.hash, bytes: part.bytes }] }],
    });
    const tampered = new Uint8Array(part.data);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;
    expect((await call(bob, "PUT", `/packs/1/${pack.pack_hash}/1`, tampered)).status).toBe(400);
  });
});

describe("per-user isolation", () => {
  it("never shows or changes another user's vault", async () => {
    const alice = await createUser("Alice2");
    const mallory = await createUser("Mallory");
    const { pack, part } = await uploadDisc(alice, 116, "Private.avi");
    await call(alice, "POST", "/devices", { id: uuidv7(), name: "Alice laptop" });
    const aliceDevices = (await (await call(alice, "GET", "/devices")).json()) as { devices: { id: string }[] };
    const aliceDevice = aliceDevices.devices[0]?.id ?? "";

    // Reads: Mallory's vault is empty and Alice's pack key is unreachable.
    expect(await (await call(mallory, "GET", "/sync/head")).json()).toMatchObject({ seq: 0 });
    expect(await (await call(mallory, "GET", "/sync/changes?since=0")).json()).toMatchObject({ changes: [] });
    expect(await (await call(mallory, "GET", "/sync/manifest")).json()).toMatchObject({ discs: [] });
    expect((await call(mallory, "GET", `/packs/116/${pack.pack_hash}/1`)).status).toBe(404);
    expect(await (await call(mallory, "GET", "/devices")).json()).toMatchObject({ devices: [] });

    // Writes: uploading into Alice's reservation or revoking her device fails.
    expect((await call(mallory, "PUT", `/packs/116/${pack.pack_hash}/1`, part.data)).status).toBe(404);
    expect((await call(mallory, "DELETE", `/devices/${aliceDevice}`)).status).toBe(404);
    const push = (await (
      await call(mallory, "POST", "/sync/push", { deviceId: uuidv7(), entries: [entry("disc", "116", "upsert", { title: "pwned" })] })
    ).json()) as { results: { status: string }[] };
    expect(push.results[0]?.status).toBe("applied"); // creates Mallory's own disc 116…

    // …which leaves Alice's disc untouched.
    const aliceRows = (await (await call(alice, "GET", "/sync/changes?since=0")).json()) as { changes: { row: { title: string } }[] };
    expect(aliceRows.changes[0]?.row.title).toBe("Disc 116");

    // Operator and backup routes are hidden from normal users.
    expect((await call(mallory, "GET", "/ops/usage")).status).toBe(404);
    expect((await call(mallory, "GET", `/ops/vaults/${alice.vaultId}/export`)).status).toBe(404);
  });
});

describe("account, operator and backups", () => {
  it("exports a vault for the backup token only", async () => {
    const carol = await createUser("Carol");
    await uploadDisc(carol, 7, "Song.mp3");
    const denied = await call(null, "GET", `/ops/vaults/${carol.vaultId}/export`, undefined, { Authorization: "Bearer wrong" });
    expect(denied.status).toBe(404);
    const res = await call(null, "GET", `/ops/vaults/${carol.vaultId}/export`, undefined, { Authorization: "Bearer test-ops-token" });
    const page = (await res.json()) as { sql: string; head: number };
    expect(page.sql).toContain("INSERT INTO disc ");
    const unchanged = await call(null, "GET", `/ops/vaults/${carol.vaultId}/export?ifHead=${page.head}`, undefined, {
      Authorization: "Bearer test-ops-token",
    });
    expect(unchanged.status).toBe(304);
  });

  it("lets operators change sign-up settings", async () => {
    const op = await createUser("Operator", "google-sub-operator");
    const res = await call(op, "PUT", "/ops/config", { signupMode: "open", maxUsers: 3 });
    expect(await res.json()).toMatchObject({ signupMode: "open", maxUsers: 3 });
    expect(await decideSignup(env as unknown as Env, "new@example.com", true)).toEqual({ ok: false, reason: "full" });
  });

  it("applies invite-only sign-up", async () => {
    const e = env as unknown as Env;
    await setConfig(e, "signup_mode", "invite");
    await setConfig(e, "max_users", "100");
    expect(await decideSignup(e, "stranger@example.com", true)).toEqual({ ok: false, reason: "invite_only" });
    await e.DIRECTORY.prepare("INSERT INTO invite (email, created_at) VALUES ('friend@example.com', '2026-09-13')").run();
    expect(await decideSignup(e, "friend@example.com", true)).toEqual({ ok: true });
    expect(await decideSignup(e, "friend@example.com", false)).toEqual({ ok: false, reason: "unverified" });
  });

  it("deletes an account and purges its packs", async () => {
    const dave = await createUser("Dave");
    const { pack } = await uploadDisc(dave, 3, "x.iso");
    const key = `v:${dave.vaultId}:pack:3:${pack.pack_hash}:1`;
    expect(await env.PACKS.get(key)).not.toBeNull();

    expect((await call(dave, "DELETE", "/account", { confirmEmail: "wrong@example.com" })).status).toBe(400);
    expect(await (await call(dave, "DELETE", "/account", { confirmEmail: dave.email })).json()).toMatchObject({
      deleted: true,
      packsQueuedForDeletion: 1,
    });
    expect((await call(dave, "GET", "/account")).status).toBe(401);

    expect(await purgeDueKeys(env as unknown as Env, new Date(Date.now() + 1000))).toBe(1);
    expect(await env.PACKS.get(key)).toBeNull();
  });
});
