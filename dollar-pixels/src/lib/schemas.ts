/**
 * Request shapes.
 *
 * These validate *structure* only. Every rule that involves the grid — is the
 * rectangle inside it, are those blocks free, is the tile the size that was
 * paid for — belongs to the domain services, because those rules need state
 * and a schema does not have any. In particular there is no `amount` field
 * anywhere in this file: the client never sends a price (SPEC §5).
 */

import { z } from "zod";
import { CAPTION_MAX, MAX_TILE_BYTES } from "@/domain/art";
import { MAX_SELECTION_BLOCKS, PAGE_SIZE_IDS } from "@/domain/geometry";
import { SLUG_MAX } from "@/domain/slug";

export const blockRectSchema = z.object({
  bx: z.number().int().min(0).max(10_000),
  by: z.number().int().min(0).max(10_000),
  bw: z.number().int().min(1).max(MAX_SELECTION_BLOCKS),
  bh: z.number().int().min(1).max(MAX_SELECTION_BLOCKS),
});

/**
 * A generous ceiling on the encoded string.
 *
 * The real limit is on *decoded* bytes and lives in `domain/art.ts`; this one
 * only stops an enormous body being parsed at all. Base64 costs a third more
 * than the bytes it carries, hence the 4/3, plus slack for the data-URL prefix.
 */
const MAX_TILE_CHARS = Math.ceil(MAX_TILE_BYTES * 1.4) + 64;

export const claimInputSchema = z.object({
  rect: blockRectSchema,
  caption: z.string().min(1).max(CAPTION_MAX * 4),
  colour: z.string().min(4).max(7),
  tile: z.string().max(MAX_TILE_CHARS).nullable().default(null),
});

export const signInSchema = z.object({
  displayName: z.string().min(1).max(128),
});

export const createPageSchema = z.object({
  slug: z.string().min(1).max(SLUG_MAX),
  title: z.string().min(1).max(200),
  kind: z.enum(["private", "premium"]),
  size: z.enum(PAGE_SIZE_IDS as unknown as [string, ...string[]]),
});

export type ClaimInput = z.infer<typeof claimInputSchema>;
export type CreatePageInputDto = z.infer<typeof createPageSchema>;

/** Turn a Zod failure into the message the envelope carries. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "That request was not in the expected shape.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
