import { z } from "zod";
import { SYNCED_TABLE_NAMES } from "./tables.js";

/** Every API route lives under this prefix so it never collides with app routes like `/sync`. */
export const API_PREFIX = "/api";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const isoTime = z.string().min(10).max(40);

// ── Errors ────────────────────────────────────────────────────────────────
export const ERROR_CODES = [
  "unauthorized",
  "not_found",
  "bad_request",
  "protocol_unsupported",
  "quota_exceeded",
  "free_limit",
  "signup_closed",
  "conflict",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ApiError = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    /** Seconds until retrying makes sense (daily limits reset at 00:00 UTC). */
    retryAfter: z.number().int().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ── Account ───────────────────────────────────────────────────────────────
export const Quotas = z.object({
  maxPackBytes: z.number().int(),
  maxPackUploadsPerDay: z.number().int(),
  maxMetaWritesPerDay: z.number().int(),
  maxDiscs: z.number().int(),
});

export const VaultUsage = z.object({
  day: z.string(),
  metaWrites: z.number().int(),
  packUploads: z.number().int(),
  packBytes: z.number().int(),
  discs: z.number().int(),
});
export type VaultUsage = z.infer<typeof VaultUsage>;

export const AccountResponse = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  }),
  vault: z.object({
    id: z.string(),
    name: z.string(),
    quotas: Quotas,
    usage: VaultUsage,
  }),
  operator: z.boolean(),
});
export type AccountResponse = z.infer<typeof AccountResponse>;

export const DeleteAccountRequest = z.object({ confirmEmail: z.string().email() });

// ── Devices ───────────────────────────────────────────────────────────────
export const RegisterDeviceRequest = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
});

export const Device = z.object({
  id: z.string(),
  name: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  current: z.boolean(),
});
export const DevicesResponse = z.object({ devices: z.array(Device) });

// ── Sync ──────────────────────────────────────────────────────────────────
export const HeadResponse = z.object({
  seq: z.number().int(),
  protocol: z.number().int(),
});
export type HeadResponse = z.infer<typeof HeadResponse>;

export const ManifestDisc = z.object({
  disc_no: z.number().int(),
  pack_hash: sha256.nullable(),
  parts: z.number().int(),
  bytes: z.number().int(),
  version: z.number().int(),
  deleted: z.boolean(),
});
export type ManifestDisc = z.infer<typeof ManifestDisc>;

export const ManifestResponse = z.object({
  seq: z.number().int(),
  discs: z.array(ManifestDisc),
});
export type ManifestResponse = z.infer<typeof ManifestResponse>;

export const ChangeOp = z.enum(["upsert", "delete", "pack_commit"]);
export type ChangeOp = z.infer<typeof ChangeOp>;
export const ChangeRowOp = z.enum(["upsert", "delete"]);

/**
 * One row's latest state. Served from the tables themselves (every row's `version` is the vault
 * sequence number of its last change), so a device far behind simply receives the rows that changed,
 * and pruning the audit change log never breaks sync.
 */
export const Change = z.object({
  seq: z.number().int(),
  table: z.enum(SYNCED_TABLE_NAMES),
  rowId: z.string(),
  op: ChangeRowOp,
  /** Full row after the change (tombstones keep `deleted_at`). */
  row: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type Change = z.infer<typeof Change>;

export const ChangesResponse = z.object({
  changes: z.array(Change),
  /** Pass as `since` for the next page. */
  next: z.number().int(),
  hasMore: z.boolean(),
  head: z.number().int(),
});
export type ChangesResponse = z.infer<typeof ChangesResponse>;

export const PackCommitFields = z.object({
  pack_hash: sha256,
  pack_parts: z.number().int().min(1),
  pack_bytes: z.number().int().min(0),
  pack_version: z.number().int().min(1),
  folder_count: z.number().int().min(0),
  file_count: z.number().int().min(0),
  total_kb: z.number().int().min(0),
  scanned_at: isoTime.nullable(),
});
export type PackCommitFields = z.infer<typeof PackCommitFields>;

export const PushEntry = z.object({
  /** Outbox id (UUIDv7): idempotency key, so resending never applies twice. */
  id: z.string().uuid(),
  table: z.enum(SYNCED_TABLE_NAMES),
  rowId: z.string().min(1).max(1000),
  op: ChangeOp,
  /** Changed fields only (upsert) or pack fields (pack_commit). Empty for delete. */
  fields: z.record(z.string(), z.unknown()),
  /** Row version the device last saw; 0 when it created the row. */
  baseVersion: z.number().int().min(0),
  createdAt: isoTime,
});
export type PushEntry = z.infer<typeof PushEntry>;

export const PushRequest = z.object({
  deviceId: z.string().uuid(),
  entries: z.array(PushEntry).min(1).max(20),
});
export type PushRequest = z.infer<typeof PushRequest>;

export const PushResult = z.object({
  id: z.string(),
  /** `deferred`: a daily quota or free limit was hit; keep the entry and retry after `retryAfter`. */
  status: z.enum(["applied", "duplicate", "conflict", "rejected", "deferred"]),
  retryAfter: z.number().int().optional(),
  seq: z.number().int().optional(),
  version: z.number().int().optional(),
  error: z.string().optional(),
  /** Current server row, returned with conflicts so the device can show "yours vs. theirs". */
  theirs: z.record(z.string(), z.unknown()).optional(),
});
export type PushResult = z.infer<typeof PushResult>;

export const PushResponse = z.object({
  results: z.array(PushResult),
  head: z.number().int(),
});
export type PushResponse = z.infer<typeof PushResponse>;

// ── Packs ─────────────────────────────────────────────────────────────────
export const PackPartRef = z.object({
  hash: sha256,
  bytes: z.number().int().min(1),
});
export type PackPartRef = z.infer<typeof PackPartRef>;

export const ReservePack = z.object({
  disc_no: z.number().int().min(1),
  pack_hash: sha256,
  parts: z.array(PackPartRef).min(1).max(1000),
});
export type ReservePack = z.infer<typeof ReservePack>;

export const ReserveRequest = z.object({
  packs: z.array(ReservePack).min(1).max(50),
});
export type ReserveRequest = z.infer<typeof ReserveRequest>;

export const ReserveResult = z.object({
  disc_no: z.number().int(),
  pack_hash: z.string(),
  status: z.enum(["reserved", "rejected"]),
  /** 1-based part numbers still to upload. */
  missingParts: z.array(z.number().int()),
  error: z.string().optional(),
});
export type ReserveResult = z.infer<typeof ReserveResult>;

export const ReserveResponse = z.object({ results: z.array(ReserveResult) });
export type ReserveResponse = z.infer<typeof ReserveResponse>;

export const UploadPartResponse = z.object({
  uploaded: z.literal(true),
  remainingParts: z.number().int(),
});

// ── Usage ─────────────────────────────────────────────────────────────────
export const UsageResponse = z.object({
  quotas: Quotas,
  usage: VaultUsage,
});
export type UsageResponse = z.infer<typeof UsageResponse>;

// ── Operator ──────────────────────────────────────────────────────────────
export const SIGNUP_MODES = ["invite", "open", "closed"] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

export const OpsConfigRequest = z.object({
  signupMode: z.enum(SIGNUP_MODES).optional(),
  maxUsers: z.number().int().min(1).max(100_000).optional(),
});

export const OpsInviteRequest = z.object({ email: z.string().email() });

export const OpsUsageResponse = z.object({
  users: z.number().int(),
  vaults: z.number().int(),
  signupMode: z.enum(SIGNUP_MODES),
  maxUsers: z.number().int(),
  today: z.object({ day: z.string(), kvWrites: z.number().int(), kvDeletes: z.number().int() }),
  kvBytes: z.number().int(),
  purgeQueue: z.number().int(),
});
export type OpsUsageResponse = z.infer<typeof OpsUsageResponse>;
