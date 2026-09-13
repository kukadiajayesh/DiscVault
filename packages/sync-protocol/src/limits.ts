/** Defaults shared by client and server. Server-side quotas can be overridden per vault. */
export const LIMITS = {
  /** Max outbox entries per `POST /sync/push`. */
  pushBatchSize: 20,
  /** Max packs per `POST /packs/reserve`. */
  reserveBatchSize: 50,
  /** Pack parts are cut at about this many gzipped bytes. */
  packPartTargetBytes: 2_000_000,
  /** Hard cap on one uploaded part. */
  packPartMaxBytes: 4_000_000,
  /** Max rows per `GET /sync/changes` page. */
  changesPageSize: 1000,
  /** Change-log rows older than this are pruned; devices further behind re-download metadata. */
  changeLogRetentionDays: 90,
  /** Replaced pack parts are kept this long before deletion. */
  replacedPackRetentionDays: 30,
} as const;

export interface VaultQuotas {
  maxPackBytes: number;
  maxPackUploadsPerDay: number;
  maxMetaWritesPerDay: number;
  maxDiscs: number;
}

export const DEFAULT_VAULT_QUOTAS: VaultQuotas = {
  maxPackBytes: 50 * 1024 * 1024,
  maxPackUploadsPerDay: 400,
  maxMetaWritesPerDay: 10_000,
  maxDiscs: 10_000,
};

/** Shared free-tier guards (whole Cloudflare account). */
export const GLOBAL_GUARDS = {
  kvWritesPerDay: 950,
  kvDeletesPerDay: 900,
  kvBytes: 900 * 1024 * 1024,
  defaultMaxUsers: 100,
} as const;
