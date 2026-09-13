/** Sync API protocol version, sent by the client in the `DV-Protocol` header. */
export const PROTOCOL_VERSION = 1;
/** The server accepts the current and the previous protocol version. */
export const MIN_PROTOCOL_VERSION = 1;
export const PROTOCOL_HEADER = "DV-Protocol";

/** Current disc pack format (`v` inside every pack part). */
export const PACK_FORMAT_VERSION = 1;
/** Current `.dvault` archive format (`v` inside manifest.json). */
export const ARCHIVE_FORMAT_VERSION = 1;
