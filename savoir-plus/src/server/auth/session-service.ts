import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/server/db';
import { sessions, users } from '@/server/db/schema';
import type { SessionPrincipal } from '@/server/authorization/policy';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export async function issueSession(userId: string, now: Date = new Date()): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    sessionToken: token,
    userId,
    expires: expiresAt,
  });

  return { token, expiresAt };
}

export async function resolveSession(
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<SessionPrincipal | null> {
  if (!token) {
    return null;
  }

  const [row] = await db
    .select({
      userId: users.id,
      role: users.role,
      status: users.status,
      expiresAt: sessions.expires,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.sessionToken, token), gt(sessions.expires, now)))
    .limit(1);

  return row ?? null;
}

export async function revokeSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.sessionToken, token));
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
