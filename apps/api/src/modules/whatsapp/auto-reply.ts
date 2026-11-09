import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { PrismaClient } from '@prisma/client';
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
import type { StorageProvider } from '../../integrations/storage';
import type { WhatsAppChoice, WhatsAppSender } from '../../integrations/whatsapp';
import { AppError } from '../../lib/errors';

/**
 * Automatic replies and statuses (D-123). By default a customer's message gets one short, general
 * reply; when the business is "at an event" (or another status), the status's message goes
 * instead, followed by its own photos and video (D-164). At most one automatic reply per customer per 12 hours, never to personal
 * numbers, paused customers, or a chat a team member wrote in recently.
 */

const AUTO_REPLY_GAP_MS = 12 * 60 * 60 * 1000;

const storedStatus = z.object({
  id: z.string(),
  label: z.string(),
  text: z.string(),
  assetIds: z.array(z.string()).default([]),
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
  return parsed.success ? parsed.data : statusPresetsFor(lang).map((p) => ({ ...p, assetIds: [] }));
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
/** The response shape: wording, photos, video size and whether it's ready-made (D-164). */
export const statusDtos = (statuses: StoredStatus[]) =>
  statuses.map((s) => ({
    id: s.id,
    label: s.label,
    text: s.text,
    assetIds: s.assetIds,
    preset: isPreset(s.id),
    video: s.videoKey && s.videoBytes ? { sizeBytes: s.videoBytes } : null,
  }));

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

interface Log {
  error: (obj: object, msg: string) => void;
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
  const text = (active?.text ?? business.whatsappAutoReplyText ?? autoReplyDefaultFor(lang))
    .replaceAll('{business}', business.name)
    .slice(0, 4096);
  return { text, active };
}

/** Sends the automatic reply for one incoming message, when it's due; true when it did. */
export class AutoReplier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: Log,
    private readonly storage: StorageProvider,
  ) {}

  async reply(
    business: {
      id: string;
      name: string;
      whatsappAutoReplyText: string | null;
      whatsappStatuses: unknown;
      whatsappActiveStatus: unknown;
      language: string;
    },
    number: { id: string; phone: string; status: string; autoReplyAt: Date | null },
    link: { contactId: string | null; leadId: string | null },
    teamIsTalking: boolean,
    now: Date,
    /** This business's WhatsApp (F25). */
    sender: WhatsAppSender,
    /** "When's a good time to talk?" choices under the message (D-165). */
    choices?: { button: string; rows: WhatsAppChoice[] },
  ): Promise<boolean> {
    if (teamIsTalking) return false;
    if (number.autoReplyAt && now.getTime() - number.autoReplyAt.getTime() < AUTO_REPLY_GAP_MS) {
      return false;
    }
    // Claim the slot first, so two messages arriving together get one reply.
    const claimed = await this.prisma.whatsAppNumber.updateMany({
      where: {
        id: number.id,
        OR: [
          { autoReplyAt: null },
          { autoReplyAt: { lt: new Date(now.getTime() - AUTO_REPLY_GAP_MS) } },
        ],
      },
      data: { autoReplyAt: now },
    });
    if (!claimed.count) return false;

    const { text, active } = replyTextOf(business, now);
    await this.send(
      business.id,
      number,
      link,
      choices ? [text, ...choices.rows.map((r) => `• ${r.title}`)].join('\n') : text,
      () =>
        choices
          ? sender.sendList(number.phone, text, choices.button, choices.rows)
          : sender.sendText(number.phone, text),
    );
    // The status's own photos and video (D-164), e.g. "At event".
    if (active) await this.sendStatusMedia(business.id, number, link, active, sender);
    return true;
  }

  async sendStatusMedia(
    businessId: string,
    number: { id: string; phone: string },
    link: { contactId: string | null; leadId: string | null },
    status: StoredStatus,
    sender: WhatsAppSender,
  ) {
    const assets = status.assetIds.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: status.assetIds }, businessId },
          select: { id: true, key: true },
        })
      : [];
    for (const id of status.assetIds) {
      const asset = assets.find((a) => a.id === id);
      const file = asset ? await this.storage.get(asset.key).catch(() => null) : null;
      if (!file) continue;
      let jpeg: Buffer;
      try {
        jpeg = await toWhatsAppJpeg(file);
      } catch (err) {
        this.log.error({ errName: (err as Error)?.name }, 'whatsapp status image failed');
        continue;
      }
      await this.send(businessId, number, link, '[תמונה]', () =>
        sender.sendImage(number.phone, jpeg),
      );
    }
    if (status.videoKey) {
      const video = await this.storage.get(status.videoKey).catch(() => null);
      if (video) {
        await this.send(businessId, number, link, '[וידאו]', () =>
          sender.sendVideo(number.phone, video),
        );
      }
    }
  }

  /** Sends and files the message under the customer (a failure is logged, never thrown). */
  private async send(
    businessId: string,
    number: { id: string },
    link: { contactId: string | null; leadId: string | null },
    body: string,
    go: () => Promise<{ id: string }>,
  ) {
    let id: string;
    try {
      ({ id } = await go());
    } catch (err) {
      const e = err as { name?: string; status?: number; code?: number | null };
      this.log.error(
        { errName: e?.name, status: e?.status, code: e?.code },
        'whatsapp auto-reply failed',
      );
      return;
    }
    await this.prisma.whatsAppMessage.create({
      data: {
        businessId,
        numberId: number.id,
        contactId: link.contactId,
        leadId: link.leadId,
        direction: 'OUT',
        waMessageId: id,
        body,
        status: 'sent',
      },
    });
  }
}
