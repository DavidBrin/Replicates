import "server-only";

import { createReadStream } from "node:fs";
import { mkdir, rm, readdir, stat, writeFile, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import {
  BlobNotFoundError,
  BlobRangeNotSatisfiableError,
  type BlobGetOptions,
  type BlobKey,
  type BlobListOptions,
  type BlobListResult,
  type BlobMetadata,
  type BlobPutOptions,
  type BlobReadResult,
  type BlobStore,
  type SignedUrlOptions,
} from "@/ports/blob-store";

/**
 * The development and test blob store: a directory.
 *
 * This adapter is why `pnpm dev` needs no account and no network. It is also
 * the one under test for HTTP `Range` behaviour, because the progressive
 * fallback path serves whole source files out of it and Safari is unforgiving
 * about a malformed range response — so an in-memory adapter would have been
 * easier and would have proved nothing.
 */

/** Metadata is a sidecar file. See {@link FilesystemBlobStore} for why. */
interface Sidecar {
  readonly contentType: string;
  readonly etag: string;
  readonly immutable: boolean;
}

export class FilesystemBlobStore implements BlobStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Resolve a key to a path, refusing anything that escapes the root.
   *
   * Keys reach this adapter from route handlers, and a key is the one part of
   * a media URL that is derived from user-supplied identifiers. `..` in a key
   * would otherwise be a read of any file the process can see, which on a
   * developer's machine is all of them. Checked after resolution rather than
   * by string inspection, because `%2e%2e`, redundant separators and symlinked
   * segments all normalise away before this comparison and none of them are
   * visible to a naive `includes("..")`.
   */
  private pathFor(key: BlobKey): string {
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Blob key escapes the store root: ${key}`);
    }
    return full;
  }

  private sidecarPath(key: BlobKey): string {
    return this.pathFor(key) + ".meta.json";
  }

  async put(
    key: BlobKey,
    body: ReadableStream<Uint8Array> | Uint8Array,
    options: BlobPutOptions,
  ): Promise<BlobMetadata> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    const bytes =
      body instanceof Uint8Array
        ? body
        : new Uint8Array(await new Response(body).arrayBuffer());

    /**
     * Write to a temporary name and rename into place.
     *
     * A segment is fetched by a player the instant the playlist naming it is
     * readable, and `rename` within one filesystem is atomic where a partial
     * `writeFile` is not. Without this, a reader can open a segment that is
     * half-written — which surfaces as a decode error in the browser, several
     * layers away from the upload that caused it.
     */
    const temporary = `${path}.${randomUUID()}.part`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);

    const etag = `"${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}"`;
    const sidecar: Sidecar = {
      contentType: options.contentType,
      etag,
      immutable: options.immutable ?? false,
    };
    await writeFile(this.sidecarPath(key), JSON.stringify(sidecar));

    return {
      key,
      size: bytes.byteLength,
      contentType: options.contentType,
      etag,
      lastModified: new Date(),
    };
  }

  async head(key: BlobKey): Promise<BlobMetadata> {
    const path = this.pathFor(key);
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new BlobNotFoundError(key);
    }

    const sidecar = await this.readSidecar(key);
    return {
      key,
      size: info.size,
      contentType: sidecar.contentType,
      etag: sidecar.etag,
      lastModified: info.mtime,
    };
  }

  async get(key: BlobKey, options?: BlobGetOptions): Promise<BlobReadResult> {
    const metadata = await this.head(key);

    /**
     * RFC 9110 §13.1.5: a range is only meaningful against the entity the
     * client already holds part of. If the validator no longer matches, the
     * correct answer is the whole object rather than an error — splicing a
     * range of the new encoding onto a buffer of the old one produces a
     * decode failure that looks like a corrupt file.
     */
    const range =
      options?.ifRange && options.ifRange !== metadata.etag
        ? undefined
        : options?.range;

    if (!range) {
      return {
        body: Readable.toWeb(
          createReadStream(this.pathFor(key)),
        ) as ReadableStream<Uint8Array>,
        metadata,
      };
    }

    /**
     * A zero-length object cannot satisfy any range at all — not even
     * `bytes=0-`, because there is no byte zero. Handled before the clamp
     * below, which would otherwise compute `end = -1` and hand
     * `createReadStream` a backwards range that it reads as "the whole file".
     */
    if (metadata.size === 0 || range.start >= metadata.size) {
      throw new BlobRangeNotSatisfiableError(key, range, metadata.size);
    }

    // A client may ask past the end; the answer is the rest of the object, not
    // an error. Only a start past the end is unsatisfiable (RFC 9110 §14.1.1).
    const end = Math.min(range.end ?? metadata.size - 1, metadata.size - 1);

    return {
      body: Readable.toWeb(
        createReadStream(this.pathFor(key), { start: range.start, end }),
      ) as ReadableStream<Uint8Array>,
      metadata,
      range: { start: range.start, end, total: metadata.size },
    };
  }

  async delete(key: BlobKey): Promise<void> {
    await rm(this.pathFor(key), { force: true });
    await rm(this.sidecarPath(key), { force: true });
  }

  /**
   * Paginated, though a filesystem has no reason to be.
   *
   * The page size is honoured here purely so that a caller which forgets to
   * follow the cursor breaks in development rather than only against R2,
   * where `ListObjectsV2` caps at 1000 keys. A ladder for a long video passes
   * that easily, and an adapter-shaped difference in truncation behaviour is
   * exactly the kind that ships.
   *
   * ## A prefix is lexical, not a directory
   *
   * S3 and R2 have no directories. `ListObjectsV2` with `Prefix=` returns
   * every key that *starts with* that string, so `videos/v1/720p/seg-` matches
   * `…/seg-00001.m4s` and stops at `…/init.mp4`. This adapter resolved the
   * prefix to a path and walked it as a directory, so the same call returned
   * nothing at all locally — the directory `seg-` does not exist — while
   * returning the segments in production.
   *
   * That is the worst shape a port divergence can take: not a crash, but two
   * adapters quietly disagreeing about the answer to the same question, with
   * the disagreement visible only in the environment that has no debugger
   * attached.
   *
   * So the walk starts at the nearest real ancestor directory and filters full
   * keys with `startsWith`. A prefix that *is* a directory still behaves as
   * before, because every key beneath it starts with it.
   */
  async list(
    prefix: string,
    options?: BlobListOptions,
  ): Promise<BlobListResult> {
    // The ancestor to walk from: everything up to the last separator. A prefix
    // with no separator at all is walked from the store root.
    const lastSlash = prefix.lastIndexOf("/");
    const directoryKey = lastSlash === -1 ? "" : prefix.slice(0, lastSlash);
    const base = directoryKey === "" ? this.root : this.pathFor(directoryKey);
    const keys: string[] = [];

    const walk = async (directory: string, keyPrefix: string) => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return; // A prefix matching nothing is an empty list, not an error.
      }
      // Sorted so that pagination is stable across calls — an unordered
      // readdir would let a cursor skip or repeat keys between pages.
      for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const childKey = keyPrefix ? `${keyPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(directory, entry.name), childKey);
        } else if (!entry.name.endsWith(".meta.json")) {
          keys.push(childKey);
        }
      }
    };

    await walk(base, directoryKey);

    // The lexical filter R2 applies for us. `walk` collected everything under
    // the ancestor directory; only the keys the caller actually asked for
    // survive.
    const matching = keys.filter((key) => key.startsWith(prefix));
    keys.length = 0;
    keys.push(...matching);

    const limit = options?.limit ?? 1000;
    const start = options?.cursor ? keys.indexOf(options.cursor) + 1 : 0;
    const page = keys.slice(start, start + limit);
    const objects = await Promise.all(page.map((key) => this.head(key)));
    const last = page[page.length - 1];

    return start + limit < keys.length && last !== undefined
      ? { objects, cursor: last }
      : { objects };
  }

  /**
   * Always `null`: this adapter cannot serve HTTP, so every read goes through
   * a route handler. The R2 adapter returns a real URL and takes our server
   * out of the media path entirely — that difference is the whole economic
   * argument for R2, and the port exposes it rather than hiding it.
   *
   * The parameters are named and ignored rather than omitted. A zero-arity
   * method still satisfies `BlobStore` structurally, so this compiled and
   * passed its tests — but any caller holding the *concrete* class rather than
   * the interface could not pass arguments to it, which made the class and the
   * port quietly different APIs.
   */
  async signedUrl(
    _key: BlobKey,
    _options?: SignedUrlOptions,
  ): Promise<string | null> {
    return null;
  }

  private async readSidecar(key: BlobKey): Promise<Sidecar> {
    /**
     * The sidecar carries the content type and a strong ETag, neither of which
     * a filesystem records. Losing it is not fatal — the bytes are the object
     * and the metadata is derivable — so a missing sidecar degrades to a
     * generic type rather than failing the read. That matters because the seed
     * script writes thousands of segments and a crash between the two writes
     * should not make a video unplayable.
     */
    try {
      const raw = await import("node:fs/promises").then((fs) =>
        fs.readFile(this.sidecarPath(key), "utf8"),
      );
      return JSON.parse(raw) as Sidecar;
    } catch {
      const info = await stat(this.pathFor(key));
      return {
        contentType: guessContentType(key),
        etag: `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`,
        immutable: false,
      };
    }
  }
}

/**
 * Re-exported so the adapters and the routes cannot end up with two tables.
 *
 * The allowlist moved to `./content-types` when it stopped being a convenience
 * for reads and became the authority for writes — see that module's header.
 * It lived here, and `r2.ts` imported it *from the filesystem adapter*, which
 * was already a sign it belonged to neither.
 */
export { guessContentType } from "./content-types";

/**
 * Imported as well as re-exported, and the two lines are not redundant:
 * `export … from` forwards a name to importers without binding it in this
 * module's scope, so `readSidecar`'s fallback above would be a reference to an
 * undeclared identifier with only the re-export. The same pair appears in
 * `components/theme.tsx` for the same reason.
 */
import { guessContentType } from "./content-types";
