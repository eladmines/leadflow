import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  autoReplyDefaultFor,
  languageSchema,
  REPLY_MODES,
  STATUS_PRESETS,
  statusPresetsFor,
  type Language,
  STATUS_VIDEO_MAX_BYTES,
  STATUS_VIDEOS_TOTAL_BYTES,
  statusMessages,
  type ReplyMode,
  type ReplyStatus,
} from '@leadflow/shared';
import { z } from 'zod';
import type { WhatsAppSender } from '../../integrations/whatsapp';
import type { StorageProvider } from '../../integrations/storage';
import { AppError } from '../../lib/errors';

/**
 * Automatic replies and statuses (D-123). By default a customer's message gets one short, general
 * reply; when the business is "at an event" (or another status), the status's message — and its
 * video — goes instead. At most one automatic reply per customer per 12 hours, never to personal
 * numbers, paused customers, or a chat a team member wrote in recently.
 */

const AUTO_REPLY_GAP_MS = 12 * 60 * 60 * 1000;

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
export const videoBytesUsed = (statuses: StoredStatus[]) =>
  statuses.reduce((sum, s) => sum + (s.videoBytes ?? 0), 0);

/** The response shape: wording, whether it's ready-made, and the video's size. */
export const statusDtos = (statuses: StoredStatus[]) =>
  statuses.map((s) => ({
    id: s.id,
    label: s.label,
    text: s.text,
    preset: isPreset(s.id),
    video: s.videoKey ? { sizeBytes: s.videoBytes ?? 0 } : null,
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

/** MP4 (ISO media) files carry "ftyp" at byte 4. */
const isMp4 = (b: Buffer) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp';

/** Checks a status video and returns where to store it. */
export function checkVideo(
  businessId: string,
  statuses: StoredStatus[],
  id: string,
  video: Buffer,
) {
  const status = statuses.find((s) => s.id === id);
  if (!status) throw new AppError('NOT_FOUND');
  if (!isMp4(video)) {
    throw new AppError('VALIDATION_ERROR', statusMessages.videoInvalid, {
      video: statusMessages.videoInvalid,
    });
  }
  if (video.length > STATUS_VIDEO_MAX_BYTES) {
    throw new AppError('VALIDATION_ERROR', statusMessages.videoTooLarge, {
      video: statusMessages.videoTooLarge,
    });
  }
  const others = videoBytesUsed(statuses.filter((s) => s.id !== id));
  if (others + video.length > STATUS_VIDEOS_TOTAL_BYTES) {
    throw new AppError('VALIDATION_ERROR', statusMessages.videosFull, {
      video: statusMessages.videosFull,
    });
  }
  return { status, key: `${businessId}/${randomUUID()}.mp4` };
}

interface Log {
  error: (obj: object, msg: string) => void;
}

/** Sends the automatic reply for one incoming message, when it's due; true when it did. */
export class AutoReplier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sender: WhatsAppSender,
    private readonly storage: StorageProvider,
    private readonly log: Log,
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

    const lang = languageOf(business.language);
    const statuses = statusesOf(business.whatsappStatuses, lang);
    const active = activeOf(business.whatsappActiveStatus, statuses, now);
    const text = (
      active?.status.text ??
      business.whatsappAutoReplyText ??
      autoReplyDefaultFor(lang)
    )
      .replaceAll('{business}', business.name)
      .slice(0, 4096);
    await this.send(business.id, number, link, text, () =>
      this.sender.sendText(number.phone, text),
    );
    const videoKey = active?.status.videoKey;
    if (videoKey) {
      const video = await this.storage.get(videoKey).catch(() => null);
      if (video) {
        await this.send(business.id, number, link, '[וידאו]', () =>
          this.sender.sendVideo(number.phone, video),
        );
      }
    }
    return true;
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
