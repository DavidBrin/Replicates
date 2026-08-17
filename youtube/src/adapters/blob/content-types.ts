/**
 * What a blob key is allowed to be, as a media type.
 *
 * ## Why this is a module and not a line in the upload route
 *
 * The content type of a stored object is not metadata. It is the instruction
 * the browser follows when the bytes come back, and this application serves
 * every one of its blobs from its own origin at `/api/media/…` — so whatever
 * is written here is what a victim's browser will *do* with the response.
 *
 * The upload path used to take it from the client:
 *
 *     const contentType = request.headers.get("content-type") ?? guess(key);
 *
 * An authenticated uploader could therefore store `text/html` under a key they
 * legitimately own, and `/api/media/videos/<theirs>/whatever.m4s` would come
 * back as a document, on the application's own origin, with the viewer's
 * session cookie attached. That is stored cross-site scripting with the
 * session as its payload, and no amount of care in the React tree affects it,
 * because the response never passes through React.
 *
 * So the type is **derived, never accepted**. The key's extension selects from
 * the table below and nothing else is storable. A client may still *declare* a
 * type — the upload target echoes one back so the browser sends a matching
 * header — but the declaration is checked against the derivation rather than
 * trusted over it.
 *
 * ## Why the table is small, and closed
 *
 * Every entry is something this application actually writes: HLS playlists and
 * CMAF segments from the packager, the progressive MP4 fallback, WebVTT
 * captions, and the three image formats thumbnails and channel art use. There
 * is no `application/octet-stream` fallback for *writes*, because a fallback
 * is how an unexpected extension becomes storable — and the one extension
 * nobody thought about is the one an attacker picks.
 *
 * Reads are different and do have a fallback: an object already in the store
 * may predate this table, and refusing to serve it would break a library
 * rather than protect anyone. {@link servableContentType} is that path, and it
 * degrades to a type the browser will not execute.
 */

/**
 * Extension → media type. Lowercase keys; the lookup lowercases too.
 *
 * `video/iso.segment` for `.m4s` is the registered type for a CMAF segment.
 * `application/vnd.apple.mpegurl` is the registered HLS type — `.m3u8` also
 * has the older `audio/x-mpegurl` in the wild, and Safari accepts both, so the
 * registered one is used rather than the folklore one.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  m3u8: "application/vnd.apple.mpegurl",
  mpd: "application/dash+xml",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  m4a: "audio/mp4",
  webm: "video/webm",
  vtt: "text/vtt",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * The type a browser is told the bytes are when the object cannot be placed.
 *
 * Deliberately not `text/plain`: a browser will render that, and a renderable
 * type is exactly what this whole module exists to prevent. `octet-stream`
 * paired with `nosniff` and an attachment disposition is inert.
 */
export const OPAQUE_CONTENT_TYPE = "application/octet-stream";

function extensionOf(key: string): string {
  const lastSlash = key.lastIndexOf("/");
  const name = lastSlash === -1 ? key : key.slice(lastSlash + 1);
  const dot = name.lastIndexOf(".");
  // `dot <= 0` covers both "no extension" and a dotfile like `.keep`, whose
  // leading dot does not introduce one.
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * The media type this key may be stored as, or `null` if it may not be stored.
 *
 * `null` is a refusal, not a default — callers on the write path must turn it
 * into a 4xx rather than substituting something.
 */
export function contentTypeForKey(key: string): string | null {
  return CONTENT_TYPES[extensionOf(key)] ?? null;
}

/**
 * Whether a client's declared type is the one the key implies.
 *
 * Parameters are ignored: a browser sending `text/vtt; charset=utf-8` for a
 * `.vtt` is agreeing with us, not disagreeing. The comparison is on the
 * essence, lowercased, which is what RFC 9110 calls the type/subtype pair.
 */
export function declaredTypeMatchesKey(key: string, declared: string): boolean {
  const expected = contentTypeForKey(key);
  if (expected === null) return false;
  const essence = declared.split(";")[0]?.trim().toLowerCase() ?? "";
  return essence === expected;
}

/**
 * The type to put on a *response*, given what the store has recorded.
 *
 * Reads cannot refuse the way writes can, so this is the degrading path: a
 * stored type that is not in the table — an object written before this module
 * existed, or by something other than this application — is served opaque
 * rather than served as whatever it claims to be.
 *
 * The key's own derivation wins over the stored value where they disagree.
 * That is the conservative direction: the key namespace is validated on every
 * write, the stored header is a value that was recorded once and may have been
 * recorded by an earlier, laxer version of this code.
 */
export function servableContentType(
  key: string,
  stored: string | undefined,
): { readonly contentType: string; readonly inline: boolean } {
  const derived = contentTypeForKey(key);
  if (derived !== null) return { contentType: derived, inline: true };

  const essence = stored?.split(";")[0]?.trim().toLowerCase() ?? "";
  const known = Object.values(CONTENT_TYPES).includes(essence);
  return known
    ? { contentType: essence, inline: true }
    : { contentType: OPAQUE_CONTENT_TYPE, inline: false };
}

/**
 * The read-path guess kept for the adapters' own metadata, where an absent
 * stored type has to become *something* and refusing is not an option.
 */
export function guessContentType(key: string): string {
  return contentTypeForKey(key) ?? OPAQUE_CONTENT_TYPE;
}
