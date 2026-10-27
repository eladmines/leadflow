import type { FastifyInstance } from 'fastify';
import type { MembershipRole, PrismaClient } from '@prisma/client';
import { apiPaths, type Business } from '@leadflow/shared';
import { csrfHeaders, sessionCookie } from './helpers';
import { registerUser } from './auth-helpers';

type Inject = Pick<FastifyInstance, 'inject'>;

export const bpaths = apiPaths.businesses;

let seq = 0;
/** Registers a fresh user (unique email) and returns its session token. */
export async function newUser(app: Inject, label = 'user') {
  seq += 1;
  const { token, user } = await registerUser(app, {
    email: `${label}-${seq}-${Date.now()}@example.com`,
  });
  return { token, userId: user.id };
}

/** JSON request with CSRF marker and session cookie. */
export function req(
  app: Inject,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  token?: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { ...csrfHeaders, ...(token ? sessionCookie(token) : {}) },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
}

/** Creates a business via the API; the caller becomes OWNER. */
export async function createBusiness(
  app: Inject,
  token: string,
  body: Record<string, unknown> = { name: 'מספרת שירן', industry: 'beauty' },
): Promise<Business> {
  const res = await req(app, 'POST', bpaths.create, token, body);
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${res.body}`);
  return res.json().business as Business;
}

/** Owner + business, ready to use. */
export async function ownerWithBusiness(app: Inject, label = 'owner') {
  const owner = await newUser(app, label);
  const business = await createBusiness(app, owner.token);
  return { ...owner, business };
}

/** Adds an existing user to a business with a role (invites arrive in F09). */
export function addMember(
  prisma: PrismaClient,
  businessId: string,
  userId: string,
  role: MembershipRole,
) {
  return prisma.membership.create({ data: { businessId, userId, role } });
}
