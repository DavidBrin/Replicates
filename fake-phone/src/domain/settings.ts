/**
 * User settings: the schema, the defaults, and the migration/repair rules.
 *
 * Everything here is pure. Persistence is a port (`ports/settings-store.ts`) so
 * the same schema is reused unchanged by a future server-synced or native
 * store.
 *
 * The parse is *repairing*, not throwing. A safety tool must open into a
 * ringing call even when its stored settings are from an older build, were
 * hand-edited, or are corrupt — falling back to defaults for the bad fields is
 * always better than an error screen at the moment someone needs the app.
 */

import { z } from "zod";

export const CALL_SKINS = ["ios", "android"] as const;
export type CallSkin = (typeof CALL_SKINS)[number];

export const VOICE_TIERS = ["silent", "scripted", "ai"] as const;
export type VoiceTier = (typeof VOICE_TIERS)[number];

/** Ring delays offered in the UI. Capped at 60s on purpose: mobile Safari
 * suspends timers and audio when the screen locks, so a delay long enough for
 * the user to pocket the phone is a delay long enough to silently fail
 * (research/web-platform-constraints.md §2). We only offer what we can keep. */
export const RING_DELAYS_SECONDS = [0, 5, 15, 30, 60] as const;

export const callerSettingsSchema = z.object({
  name: z.string().trim().min(1).max(40).default("Mum"),
  /** The line under the name — "mobile", "iPhone", a relationship. */
  label: z.string().trim().max(24).default("mobile"),
  /** Data URL or object URL for the contact photo; empty means monogram. */
  photo: z.string().max(4_000_000).default(""),
});

export const liveSettingsSchema = z.object({
  username: z.string().trim().min(1).max(30).default("you"),
  avatar: z.string().max(4_000_000).default(""),
  /** Starting viewer count; the session model drifts upward from here. */
  viewers: z.number().int().min(0).max(9_999_999).default(148),
  /** Simulated comments per minute. 0 disables the comment stream. */
  commentsPerMinute: z.number().int().min(0).max(120).default(24),
});

/**
 * Nested defaults are pre-parsed rather than written as `.default({})`.
 *
 * Zod 4 treats a `.default()` value as an *output* that bypasses parsing, so
 * `.default({})` yields a literally empty `caller` object — every field
 * `undefined` — instead of the field defaults. That surfaces as a call screen
 * with no caller name, which is a silent, total product failure. Parsing the
 * empty object once here makes the defaults real.
 */
const defaultCaller = callerSettingsSchema.parse({});
const defaultLive = liveSettingsSchema.parse({});

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  skin: z.enum(CALL_SKINS).default("ios"),
  voiceTier: z.enum(VOICE_TIERS).default("scripted"),
  personaId: z.string().trim().min(1).max(64).default("friend-nearby"),
  ringDelaySeconds: z.number().int().min(0).max(60).default(0),
  /** Auto-answer after N seconds of ringing, for a hands-free escape. 0 = off. */
  autoAnswerSeconds: z.number().int().min(0).max(60).default(0),
  ringtoneEnabled: z.boolean().default(true),
  /** Subtitles under the caller's spoken lines. On by default because iOS
   * speech synthesis is unreliable enough that the call must still read as
   * real when no sound comes out (research/web-platform-constraints.md §8). */
  showSubtitles: z.boolean().default(true),
  caller: callerSettingsSchema.default(defaultCaller),
  live: liveSettingsSchema.default(defaultLive),
});

export type Settings = z.infer<typeof settingsSchema>;
export type CallerSettings = z.infer<typeof callerSettingsSchema>;
export type LiveSettings = z.infer<typeof liveSettingsSchema>;

export const defaultSettings: Settings = settingsSchema.parse({});

/**
 * Looks through `.default()` / `.optional()` wrappers for an object schema.
 *
 * `caller` and `live` are declared as `callerSettingsSchema.default(...)`, so
 * the value sitting in `settingsSchema.shape` is a `ZodDefault`, not the object
 * schema itself. Unwrapping structurally rather than special-casing those two
 * keys means a third nested group added later gets field-level repair for free
 * instead of silently losing it.
 */
function asObjectSchema(schema: z.ZodType): z.ZodObject | null {
  let current: z.ZodType = schema;
  // Bounded rather than `while (true)`: this is the one code path that has to
  // work when everything else about the stored data is broken, so it must not
  // be able to hang on a wrapper chain that loops back on itself.
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof z.ZodObject) return current;
    const inner = (current as { unwrap?: () => z.ZodType }).unwrap?.();
    if (!inner) return null;
    current = inner;
  }
  return null;
}

/**
 * Repairs one object against its schema, field by field, recursively.
 *
 * The recursion is the point. Validating `caller` as a whole means a single
 * oversized photo — the field most likely to go bad, since it is the only one
 * that can blow the storage quota — also discards the carefully-configured
 * caller name and label beside it. That is exactly the all-or-nothing failure
 * D16 exists to forbid, and a promise of field-level repair that stops at the
 * top level is not one.
 *
 * A field that cannot be repaired is left out entirely, which lets the schema's
 * own default fill it in on the final parse.
 */
function repairObject<Shape extends Record<string, z.ZodType>>(
  schema: z.ZodObject<Shape>,
  raw: unknown,
): z.infer<z.ZodObject<Shape>> {
  const whole = schema.safeParse(raw);
  if (whole.success) return whole.data;

  // Not an object at all — a string, a number, a `null` from a truncated write.
  // There are no individual fields left to salvage, so take the defaults.
  if (typeof raw !== "object" || raw === null) return schema.parse({});

  const record = raw as Record<string, unknown>;
  const repaired: Record<string, unknown> = {};

  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    const field = fieldSchema.safeParse(record[key]);
    if (field.success) {
      repaired[key] = field.data;
      continue;
    }

    const nested = asObjectSchema(fieldSchema);
    if (nested) repaired[key] = repairObject(nested, record[key]);
  }

  return schema.parse(repaired);
}

/**
 * Parses stored settings, repairing anything invalid.
 *
 * Field-level repair rather than all-or-nothing: a single bad field (a photo
 * that exceeded quota and got truncated, say) must not discard the user's
 * carefully-configured caller name — at any depth. Unknown keys from a future
 * version are dropped silently by the schema.
 */
export function parseSettings(raw: unknown): Settings {
  return repairObject(settingsSchema, raw);
}
