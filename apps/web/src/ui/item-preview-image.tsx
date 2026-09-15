import { type CSSProperties, useEffect, useState } from "react";
import { vaultWorker } from "../db/rpc.js";
import { GenreIcon } from "./genre-icon.js";

/**
 * One AI-identified item's preview image (§ image preview): prefers the locally cached blob (works
 * offline, built from a downloaded copy on a previous analysis), falling back to the resolved
 * external URL directly over the network if nothing's cached yet. Renders a beautiful fallback
 * placeholder icon matching the item's contentType if no image is available.
 */
export function ItemPreviewImage({
  itemId,
  imageUrl,
  style,
  contentType,
}: {
  itemId: string;
  imageUrl: string | null;
  style?: CSSProperties;
  contentType?: string;
}) {
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

  if (!src || failed) {
    // Determine thumbnail dimension to scale the centered placeholder icon
    const sizeWidth = style?.width ? (typeof style.width === "number" ? style.width : parseInt(String(style.width), 10)) : 40;
    const iconSize = Math.max(16, Math.min(24, sizeWidth * 0.4));

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--dv-bg-sub)",
          border: "1px dashed var(--dv-border-2)",
          color: "var(--dv-text-3)",
          ...style,
        }}
      >
        <GenreIcon name={contentType ?? "other"} type="title" size={iconSize} />
      </div>
    );
  }

  return <img src={src} alt="" onError={() => setFailed(true)} style={style} />;
}
