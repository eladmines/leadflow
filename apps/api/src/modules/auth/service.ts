import { Prisma, type PrismaClient, type User } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  EMAIL_VERIFY_TOKEN_TTL_MS,
  PASSWORD_RESET_TOKEN_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  accountMessages,
  authMessages,
  authWebPaths,
  type AuthAuditAction,
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
} from '@leadflow/shared';
import type { AppConfig } from '../../config/env';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import {
  DUMMY_PASSWORD_HASH,
  generateToken,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from '../../lib/crypto';
import {
  passwordChangedTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
  type EmailSender,
} from '../../integrations/email';
import { recordAudit, recordAuditSafe, type AuditEntry } from '../audit/service';
import type { AuthState } from '../../plugins/session';
import * as repo from './repo';

const USER_AGENT_MAX = 512;
const IP_MAX = 45;

/** Per-request context the service needs (never contains secrets). */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  log: FastifyBaseLogger;
}

export interface AuthServiceDeps {
  prisma: PrismaClient;
  email: EmailSender;
  config: AppConfig;
}

/** The result of register/login: the user plus the raw session token for the cookie. */
export interface SignedIn {
  user: User;
  sessionToken: string;
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function requestMeta(req: {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  log: FastifyBaseLogger;
}): RequestMeta {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ? req.ip.slice(0, IP_MAX) : null,
    userAgent: typeof ua === 'string' ? ua.slice(0, USER_AGENT_MAX) : null,
    log: req.log,
  };
}

const invalidToken = () =>
  new AppError('VALIDATION_ERROR', undefined, { token: authMessages.tokenInvalid });
const invalidCredentials = () => new AppError('UNAUTHENTICATED', authMessages.invalidCredentials);

function audit(action: AuthAuditAction, entry: Omit<AuditEntry, 'action'>): AuditEntry {
  return { action, businessId: null, ...entry };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  private get prisma() {
    return this.deps.prisma;
  }

  // -------------------------------------------------------------------------
  // Register / login / logout
  // -------------------------------------------------------------------------

  async register(
    input: RegisterRequest,
    meta: RequestMeta,
    current: AuthState | null,
  ): Promise<SignedIn> {
    if (await repo.findUserByEmail(this.prisma, input.email)) throw emailTaken();

    const passwordHash = await hashPassword(input.password);
    const verifyToken = generateToken();
    const now = new Date();

    let result: SignedIn;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        if (current) await repo.revokeSession(tx, current.session.id, now);
        const user = await repo.createUser(tx, {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
        });
        const { token: sessionToken } = await this.createSession(tx, user.id, meta, now);
        await repo.createAuthToken(tx, {
          userId: user.id,
          type: 'EMAIL_VERIFY',
          tokenHash: sha256Hex(verifyToken),
          expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TOKEN_TTL_MS),
        });
        await recordAudit(
          tx,
          audit('auth.register', {
            actorUserId: user.id,
            entityType: 'user',
            entityId: user.id,
            metadata: { ip: meta.ip, userAgent: meta.userAgent },
          }),
        );
        return { user, sessionToken };
      });
    } catch (err) {
      // A concurrent registration of the same email.
      if (isUniqueViolation(err)) throw emailTaken();
      throw err;
    }

    await this.sendVerificationEmail(result.user, verifyToken, 'register', meta);
    return result;
  }

  async login(
    input: LoginRequest,
    meta: RequestMeta,
    current: AuthState | null,
  ): Promise<SignedIn> {
    const user = await repo.findUserByEmail(this.prisma, input.email);

    if (!user) {
      // Same argon2 cost as a real check, so timing doesn't reveal unknown emails.
      await verifyPassword(DUMMY_PASSWORD_HASH, input.password);
      await this.loginFailed(null, 'unknown_email', meta);
      throw invalidCredentials();
    }

    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (!passwordOk) {
      await this.loginFailed(user.id, 'bad_password', meta);
      throw invalidCredentials();
    }
    if (user.status !== 'ACTIVE') {
      await this.loginFailed(user.id, 'blocked', meta);
      throw invalidCredentials();
    }

    const now = new Date();
    const sessionToken = await this.prisma.$transaction(async (tx) => {
      // No session fixation: a sign-in while signed in replaces the old session.
      if (current) await repo.revokeSession(tx, current.session.id, now);
      const { token, sessionId } = await this.createSession(tx, user.id, meta, now);
      await recordAudit(
        tx,
        audit('auth.login.succeeded', {
          actorUserId: user.id,
          entityType: 'user',
          entityId: user.id,
          metadata: { ip: meta.ip, userAgent: meta.userAgent, sessionId },
        }),
      );
      return token;
    });
    return { user, sessionToken };
  }

  /** Idempotent: with no valid session there is nothing to revoke. */
  async logout(current: AuthState | null, meta: RequestMeta): Promise<void> {
    if (!current) return;
    const now = new Date();
    await repo.revokeSession(this.prisma, current.session.id, now);
    await recordAuditSafe(
      this.prisma,
      meta.log,
      audit('auth.logout', {
        actorUserId: current.user.id,
        entityType: 'session',
        entityId: current.session.id,
        metadata: { ip: meta.ip },
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Email verification
  // -------------------------------------------------------------------------

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    const now = new Date();
    const row = await repo.findAuthTokenByHash(this.prisma, sha256Hex(token));
    if (
      !row ||
      row.type !== 'EMAIL_VERIFY' ||
      row.usedAt !== null ||
      row.expiresAt <= now ||
      row.user.status !== 'ACTIVE'
    ) {
      throw invalidToken();
    }

    await this.prisma.$transaction(async (tx) => {
      if (!(await repo.consumeAuthToken(tx, row.id, now))) throw invalidToken();
      // Any outstanding verify link is now pointless.
      await repo.markUnusedTokensUsed(tx, row.userId, 'EMAIL_VERIFY', now);
      await repo.markEmailVerified(tx, row.userId, now);
    });

    await recordAuditSafe(
      this.prisma,
      meta.log,
      audit('auth.email.verified', {
        actorUserId: null,
        entityType: 'user',
        entityId: row.userId,
        metadata: { ip: meta.ip },
      }),
    );
  }

  /** Already verified → no-op (D-022). Earlier unused verify links stay valid. */
  async resendVerification(user: User, meta: RequestMeta): Promise<void> {
    if (user.emailVerifiedAt !== null) return;
    const token = generateToken();
    await repo.createAuthToken(this.prisma, {
      userId: user.id,
      type: 'EMAIL_VERIFY',
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFY_TOKEN_TTL_MS),
    });
    await this.sendVerificationEmail(user, token, 'resend', meta);
  }

  // -------------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------------

  /**
   * Always resolves (the route answers 204 either way). Only an existing ACTIVE user gets a
   * new link, and only the newest link stays valid.
   */
  async requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
    const user = await repo.findUserByEmail(this.prisma, email);
    if (!user || user.status !== 'ACTIVE') return;

    const token = generateToken();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await repo.markUnusedTokensUsed(tx, user.id, 'PASSWORD_RESET', now);
      await repo.createAuthToken(tx, {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
      });
    });
    await recordAuditSafe(
      this.prisma,
      meta.log,
      audit('auth.password_reset.requested', {
        actorUserId: null,
        entityType: 'user',
        entityId: user.id,
        metadata: { ip: meta.ip },
      }),
    );

    const message = passwordResetTemplate({
      fullName: user.fullName,
      link: this.webLink(authWebPaths.resetPassword, token),
    });
    // Not awaited: the response time must not depend on the mail server, so an existing
    // and an unknown email look the same to the caller.
    void this.deps.email
      .send({ to: user.email, ...message })
      .catch((err: unknown) => logSendFailure(meta.log, 'password_reset', err));
  }

  async confirmPasswordReset(token: string, newPassword: string, meta: RequestMeta) {
    const now = new Date();
    const row = await repo.findAuthTokenByHash(this.prisma, sha256Hex(token));
    if (
      !row ||
      row.type !== 'PASSWORD_RESET' ||
      row.usedAt !== null ||
      row.expiresAt <= now ||
      row.user.status !== 'ACTIVE'
    ) {
      throw invalidToken();
    }

    const passwordHash = await hashPassword(newPassword);

    await this.prisma.$transaction(async (tx) => {
      if (!(await repo.consumeAuthToken(tx, row.id, now))) throw invalidToken();
      await repo.markUnusedTokensUsed(tx, row.userId, 'PASSWORD_RESET', now);
      await repo.updatePasswordHash(tx, row.userId, passwordHash);
      // Using the link proves inbox ownership (D-021).
      await repo.markEmailVerified(tx, row.userId, now);
      const revokedSessions = await repo.revokeAllSessions(tx, row.userId, now);
      await recordAudit(
        tx,
        audit('auth.password_reset.completed', {
          actorUserId: null,
          entityType: 'user',
          entityId: row.userId,
          metadata: { ip: meta.ip, revokedSessions },
        }),
      );
    });
  }

  // -------------------------------------------------------------------------
  // Account settings
  // -------------------------------------------------------------------------

  async updateProfile(auth: AuthState, fullName: string): Promise<User> {
    if (fullName === auth.user.fullName) return auth.user;
    return this.prisma.$transaction(async (tx) => {
      const user = await repo.updateFullName(tx, auth.user.id, fullName);
      await recordAudit(
        tx,
        audit('auth.profile.updated', {
          actorUserId: auth.user.id,
          entityType: 'user',
          entityId: auth.user.id,
        }),
      );
      return user;
    });
  }

  /**
   * Requires the current password. Other sessions are signed out (this one stays), and a notice
   * goes to the account email in case it wasn't the owner (O-008).
   */
  async changePassword(
    auth: AuthState,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ) {
    if (!(await verifyPassword(auth.user.passwordHash, currentPassword))) {
      throw new AppError('VALIDATION_ERROR', accountMessages.currentPasswordWrong, {
        currentPassword: accountMessages.currentPasswordWrong,
      });
    }
    if (currentPassword === newPassword) {
      throw new AppError('VALIDATION_ERROR', accountMessages.samePassword, {
        newPassword: accountMessages.samePassword,
      });
    }
    const passwordHash = await hashPassword(newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await repo.updatePasswordHash(tx, auth.user.id, passwordHash);
      const revokedSessions = await repo.revokeOtherSessions(
        tx,
        auth.user.id,
        auth.session.id,
        now,
      );
      await recordAudit(
        tx,
        audit('auth.password.changed', {
          actorUserId: auth.user.id,
          entityType: 'user',
          entityId: auth.user.id,
          metadata: { ip: meta.ip, revokedSessions },
        }),
      );
    });
    const message = passwordChangedTemplate({
      fullName: auth.user.fullName,
      resetLink: `${this.deps.config.APP_URL}${authWebPaths.forgotPassword}`,
    });
    await this.deps.email
      .send({ to: auth.user.email, ...message })
      .catch((err: unknown) => logSendFailure(meta.log, 'password_changed', err));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async createSession(db: Db, userId: string, meta: RequestMeta, now: Date) {
    const token = generateToken();
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
    const session = await repo.createSession(db, {
      userId,
      tokenHash: sha256Hex(token),
      now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
      absoluteExpiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { token, sessionId: session.id };
  }

  private async loginFailed(
    userId: string | null,
    reason: 'unknown_email' | 'bad_password' | 'blocked',
    meta: RequestMeta,
  ) {
    await recordAuditSafe(
      this.prisma,
      meta.log,
      audit('auth.login.failed', {
        actorUserId: null,
        entityType: 'user',
        entityId: userId,
        metadata: { ip: meta.ip, userAgent: meta.userAgent, reason },
      }),
    );
  }

  /** Sends a verify email. A failure is logged (never the token) and doesn't fail the request. */
  private async sendVerificationEmail(
    user: User,
    token: string,
    trigger: 'register' | 'resend',
    meta: RequestMeta,
  ) {
    const message = verifyEmailTemplate({
      fullName: user.fullName,
      link: this.webLink(authWebPaths.verifyEmail, token),
    });
    try {
      await this.deps.email.send({ to: user.email, ...message });
    } catch (err) {
      logSendFailure(meta.log, 'verify_email', err);
      return;
    }
    await recordAuditSafe(
      this.prisma,
      meta.log,
      audit('auth.email_verification.sent', {
        actorUserId: user.id,
        entityType: 'user',
        entityId: user.id,
        metadata: { trigger },
      }),
    );
  }

  private webLink(path: string, token: string): string {
    return `${this.deps.config.APP_URL}${path}?token=${encodeURIComponent(token)}`;
  }
}

function emailTaken() {
  return new AppError('CONFLICT', undefined, { email: authMessages.emailTaken });
}

/** Logs only the error's name/code: provider errors could echo message contents. */
function logSendFailure(log: FastifyBaseLogger, template: string, err: unknown) {
  const e = err as { name?: unknown; code?: unknown } | null;
  log.error(
    {
      template,
      errName: typeof e?.name === 'string' ? e.name : undefined,
      errCode: typeof e?.code === 'string' ? e.code : undefined,
    },
    'email send failed',
  );
}
