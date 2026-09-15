import { type CSSProperties, useEffect, useState } from "react";
import { vaultWorker } from "../db/rpc.js";

/**
 * One AI-identified item's preview image (§ image preview): prefers the locally cached blob (works
 * offline, built from a downloaded copy on a previous analysis), falling back to the resolved
 * external URL directly over the network if nothing's cached yet. Renders nothing when there's no
 * `imageUrl` at all (no lookup attempted, or no match found) — no placeholder/broken-image icon.
 */
export function ItemPreviewImage({ itemId, imageUrl, style }: { itemId: string; imageUrl: string | null; style?: CSSProperties }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    setObjectUrl(null);
    setFailed(false);
    vaultWorker()
      .discItemImageBlob(itemId)
      .then((blob) => {
        if (cancelled || !blob) return;
        createdUrl = URL.createObjectURL(new Blob([blob.data.slice()], { type: blob.contentType }));
        setObjectUrl(createdUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [itemId]);

  const src = objectUrl ?? imageUrl;
  if (!src || failed) return null;
  return <img src={src} alt="" onError={() => setFailed(true)} style={style} />;
}
