import type { Invitation as InvitationRow, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  INVITE_TTL_MS,
  INVITE_WEB_PATH,
  MAX_PENDING_INVITES,
  roleLabels,
  teamMessages,
  type Invitation,
  type InvitePreview,
} from '@leadflow/shared';
import type { AppConfig } from '../../config/env';
import { generateToken, sha256Hex } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { inviteTemplate, type EmailSender } from '../../integrations/email';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';

type Row = InvitationRow & { invitedBy: { fullName: string } | null };

const toDto = (r: Row): Invitation => ({
  id: r.id,
  email: r.email,
  role: r.role as Invitation['role'],
  invitedBy: r.invitedBy?.fullName ?? null,
  expiresAt: r.expiresAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
});

const pending = (now = new Date()) => ({
  acceptedAt: null,
  revokedAt: null,
  expiresAt: { gt: now },
});

export class TeamService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly email: EmailSender,
    private readonly log: FastifyBaseLogger,
  ) {}

  async listInvitations(ctx: TenantContext): Promise<Invitation[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { businessId: ctx.businessId, ...pending() },
      include: { invitedBy: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  /** Invites (or re-invites) an email; an older pending invite for it is replaced. */
  async invite(ctx: TenantContext, email: string, role: Invitation['role']): Promise<Invitation> {
    const member = await this.prisma.membership.findFirst({
      where: { businessId: ctx.businessId, status: 'ACTIVE', user: { email } },
    });
    if (member)
      throw new AppError('CONFLICT', teamMessages.alreadyMember, {
        email: teamMessages.alreadyMember,
      });
    const open = await this.prisma.invitation.count({
      where: { businessId: ctx.businessId, ...pending() },
    });
    if (open >= MAX_PENDING_INVITES) throw new AppError('CONFLICT', teamMessages.tooManyInvites);

    const token = generateToken();
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { businessId: ctx.businessId, email, ...pending() },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          businessId: ctx.businessId,
          email,
          role,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedById: ctx.userId,
        },
        include: { invitedBy: { select: { fullName: true } } },
      });
      await recordAudit(tx, {
        action: 'member.invited',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'invitation',
        entityId: created.id,
        metadata: { role },
      });
      return created;
    });
    await this.sendEmail(ctx.businessId, row, token);
    return toDto(row);
  }

  /** New token + fresh expiry for a pending invite (the old link stops working). */
  async resend(ctx: TenantContext, inviteId: string): Promise<Invitation> {
    const inv = await this.findPending(ctx, inviteId);
    const token = generateToken();
    const row = await this.prisma.invitation.update({
      where: { id: inv.id },
      data: { tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      include: { invitedBy: { select: { fullName: true } } },
    });
    await this.sendEmail(ctx.businessId, row, token);
    return toDto(row);
  }

  async revoke(ctx: TenantContext, inviteId: string): Promise<void> {
    const inv = await this.findPending(ctx, inviteId);
    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
      await recordAudit(tx, {
        action: 'invitation.revoked',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'invitation',
        entityId: inv.id,
      });
    });
  }

  private async findPending(ctx: TenantContext, inviteId: string) {
    const inv = /^[0-9a-f-]{36}$/i.test(inviteId)
      ? await this.prisma.invitation.findFirst({
          where: { id: inviteId, businessId: ctx.businessId, ...pending() },
        })
      : null;
    if (!inv) throw new AppError('NOT_FOUND');
    return inv;
  }

  private async sendEmail(businessId: string, row: Row, token: string) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true },
    });
    const mail = inviteTemplate({
      businessName: business.name,
      inviterName: row.invitedBy?.fullName ?? null,
      roleLabel: roleLabels[row.role],
      link: `${this.config.APP_URL}${INVITE_WEB_PATH}?token=${token}`,
      days: Math.round(INVITE_TTL_MS / 86_400_000),
    });
    try {
      await this.email.send({ to: row.email, ...mail });
    } catch (err) {
      // The invite stays valid; the owner can resend.
      this.log.error({ errName: (err as Error)?.name, template: 'invite' }, 'invite email failed');
    }
  }

  /** Owner changes a manager/employee's role. The owner's own membership can't be changed here. */
  async changeRole(ctx: TenantContext, userId: string, role: Invitation['role']) {
    const m = await this.findMember(ctx, userId);
    if (m.role === 'OWNER') throw new AppError('FORBIDDEN', teamMessages.cannotChangeOwner);
    if (m.role === role) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: m.id }, data: { role } });
      await recordAudit(tx, {
        action: 'member.role_changed',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'membership',
        entityId: m.id,
        metadata: { from: m.role, to: role },
      });
    });
  }

  /** Removes access immediately (membership disabled; history and assigned leads are kept). */
  async remove(ctx: TenantContext, userId: string) {
    const m = await this.findMember(ctx, userId);
    if (m.role === 'OWNER') throw new AppError('FORBIDDEN', teamMessages.cannotChangeOwner);
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: m.id }, data: { status: 'DISABLED' } });
      await recordAudit(tx, {
        action: 'member.removed',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'membership',
        entityId: m.id,
      });
    });
  }

  private async findMember(ctx: TenantContext, userId: string) {
    const m = /^[0-9a-f-]{36}$/i.test(userId)
      ? await this.prisma.membership.findFirst({
          where: { businessId: ctx.businessId, userId, status: 'ACTIVE' },
        })
      : null;
    if (!m) throw new AppError('NOT_FOUND');
    return m;
  }

  // ---------------------------------------------------------------------------
  // Invitee side (not tenant-scoped: the token identifies the invitation)
  // ---------------------------------------------------------------------------

  private async byToken(token: string) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { business: { select: { name: true } }, invitedBy: { select: { fullName: true } } },
    });
    if (!inv) throw new AppError('NOT_FOUND', teamMessages.inviteInvalid);
    return inv;
  }

  async preview(token: string): Promise<InvitePreview> {
    const inv = await this.byToken(token);
    const status = inv.acceptedAt
      ? 'used'
      : inv.revokedAt
        ? 'revoked'
        : inv.expiresAt <= new Date()
          ? 'expired'
          : 'valid';
    return {
      status,
      businessName: inv.business.name,
      email: inv.email,
      role: inv.role as InvitePreview['role'],
      invitedBy: inv.invitedBy?.fullName ?? null,
    };
  }

  /**
   * Joins the business. The signed-in user's email must equal the invited email; the link proves
   * they control that inbox, so the email is marked verified too.
   */
  async accept(token: string, user: { id: string; email: string; emailVerifiedAt: Date | null }) {
    const inv = await this.byToken(token);
    if (inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) {
      throw new AppError('VALIDATION_ERROR', teamMessages.inviteInvalid);
    }
    if (user.email !== inv.email) throw new AppError('FORBIDDEN', teamMessages.wrongAccount);

    await this.prisma.$transaction(async (tx) => {
      // Single use, even under concurrency.
      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw new AppError('VALIDATION_ERROR', teamMessages.inviteInvalid);
      const existing = await tx.membership.findUnique({
        where: { userId_businessId: { userId: user.id, businessId: inv.businessId } },
      });
      if (existing?.status === 'ACTIVE') return; // already a member: nothing to change
      if (existing) {
        await tx.membership.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', role: inv.role, invitedAt: inv.createdAt },
        });
      } else {
        await tx.membership.create({
          data: {
            userId: user.id,
            businessId: inv.businessId,
            role: inv.role,
            invitedAt: inv.createdAt,
          },
        });
      }
      if (!user.emailVerifiedAt)
        await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      await recordAudit(tx, {
        action: 'member.joined',
        businessId: inv.businessId,
        actorUserId: user.id,
        entityType: 'invitation',
        entityId: inv.id,
        metadata: { role: inv.role },
      });
    });
    return { businessId: inv.businessId };
  }
}
