import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  autoReplyDefaultFor,
  languageSchema,
  REPLY_MODES,
  STATUS_PRESETS,
  statusPresetsFor,
  type Language,
  SHOWCASE_VIDEO_MAX_BYTES,
  showcaseMessages,
  type ReplyMode,
  type ReplyStatus,
} from '@leadflow/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';

/**
 * Automatic replies and statuses (D-123, D-166). Every customer message gets the general reply;
 * when the business is "at an event" (or another status), the status's message instead. Never to
 * personal numbers, paused customers, or a chat a team member wrote in recently.
 */

const storedStatus = z.object({
  id: z.string(),
  label: z.string(),
  text: z.string(),
  videoKey: z.string().optional(),
  videoBytes: z.number().int().optional(),
});
export type StoredStatus = z.infer<typeof storedStatus>;
const activeSchema = z.object({ id: z.string(), until: z.string().datetime().nullable() });

export const modeOf = (raw: string): ReplyMode =>
  (REPLY_MODES as readonly string[]).includes(raw) ? (raw as ReplyMode) : 'auto_reply';

/** The business's statuses; the ready-made ones (in its language) until it saves its own list. */
export function statusesOf(raw: unknown, lang: Language = 'he'): StoredStatus[] {
  const parsed = z.array(storedStatus).safeParse(raw);
  return parsed.success ? parsed.data : statusPresetsFor(lang).map((p) => ({ ...p }));
}

/** A business's language as stored (D-143); anything else is Hebrew. */
export const languageOf = (raw: string | null | undefined): Language =>
  languageSchema.catch('he').parse(raw);

/** The status on now, if it still exists and hasn't ended. */
export function activeOf(raw: unknown, statuses: StoredStatus[], now: Date) {
  const a = activeSchema.safeParse(raw);
  if (!a.success) return null;
  const status = statuses.find((s) => s.id === a.data.id);
  if (!status) return null;
  if (a.data.until && new Date(a.data.until) <= now) return null;
  return { status, until: a.data.until };
}

const isPreset = (id: string) => STATUS_PRESETS.some((p) => p.id === id);
/** The response shape: wording and whether it's ready-made (photos and video live in "A peek"). */
export const statusDtos = (statuses: StoredStatus[]) =>
  statuses.map((s) => ({ id: s.id, label: s.label, text: s.text, preset: isPreset(s.id) }));

/** A saved list: keeps each status's video by id; returns the videos to delete. */
export function mergeStatuses(old: StoredStatus[], next: ReplyStatus[]) {
  const merged: StoredStatus[] = next.map((s) => {
    const prev = old.find((o) => o.id === s.id);
    return prev?.videoKey
      ? { ...s, videoKey: prev.videoKey, videoBytes: prev.videoBytes }
      : { ...s };
  });
  const dropped = old
    .filter((o) => o.videoKey && !merged.some((m) => m.id === o.id))
    .map((o) => o.videoKey!);
  return { merged, dropped };
}

/** A library photo as WhatsApp takes it: JPEG, at most 1600 px (the library keeps WebP). */
export const toWhatsAppJpeg = (file: Buffer) =>
  sharp(file)
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();

/** MP4 (ISO media) files carry "ftyp" at byte 4. */
const isMp4 = (b: Buffer) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp';

/** The stored showcase JSON as an object (null/invalid = empty). */
export const showcaseObject = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as object) } : {};

/** The "meanwhile" video kept next to the showcase settings (server-only fields). */
export function showcaseVideoOf(raw: unknown): { key: string; bytes: number } | null {
  const v = z
    .object({ videoKey: z.string(), videoBytes: z.number().int() })
    .safeParse(showcaseObject(raw));
  return v.success ? { key: v.data.videoKey, bytes: v.data.videoBytes } : null;
}

/** Checks the "meanwhile" video (D-151) and returns where to store it. */
export function checkShowcaseVideo(businessId: string, video: Buffer) {
  if (!isMp4(video)) {
    throw new AppError('VALIDATION_ERROR', showcaseMessages.videoInvalid, {
      video: showcaseMessages.videoInvalid,
    });
  }
  if (video.length > SHOWCASE_VIDEO_MAX_BYTES) {
    throw new AppError('VALIDATION_ERROR', showcaseMessages.videoTooLarge, {
      video: showcaseMessages.videoTooLarge,
    });
  }
  return `${businessId}/${randomUUID()}.mp4`;
}

/** The message a customer gets now: the active status's, else the general reply (D-123). */
export function replyTextOf(
  business: {
    name: string;
    whatsappAutoReplyText: string | null;
    whatsappStatuses: unknown;
    whatsappActiveStatus: unknown;
    language: string;
  },
  now: Date,
) {
  const lang = languageOf(business.language);
  const statuses = statusesOf(business.whatsappStatuses, lang);
  const active = activeOf(business.whatsappActiveStatus, statuses, now)?.status ?? null;
  return (active?.text ?? business.whatsappAutoReplyText ?? autoReplyDefaultFor(lang))
    .replaceAll('{business}', business.name)
    .slice(0, 4096);
}
