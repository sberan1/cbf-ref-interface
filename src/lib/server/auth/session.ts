/**
 * Server-side sessions (ADR 0006): a random token in an httpOnly cookie, its SHA-256 in
 * `app.session`. Accounts sign in with Google and are paired with an official by an admin
 * (ADR 0008).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { appSession, appUser, official, type UserRole, type UserStatus } from '../db/schema';

export const SESSION_COOKIE = 'cbf_session';

const DAY = 24 * 3600_000;
export const SESSION_TTL_MS = 30 * DAY;
/** Sliding expiry: a session used within its last 15 days is extended to the full TTL again. */
const RENEW_WITHIN_MS = 15 * DAY;

export interface SessionUser {
	id: number;
	email: string;
	name: string | null;
	avatarUrl: string | null;
	role: UserRole;
	status: UserStatus;
	/** approved pairing; null until an admin approves */
	officialId: number | null;
	requestedOfficialId: number | null;
	/** of the approved official */
	groupId: number | null;
	firstName: string | null;
	lastName: string | null;
	homeAddress: string | null;
	homeLat: number | null;
	homeLon: number | null;
	homeMunicipality: string | null;
}

export interface SessionInfo {
	id: string;
	expiresAt: Date;
}

export function generateSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

export function sessionIdFromToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function shouldRenew(expiresAt: Date, now: Date): boolean {
	return expiresAt.getTime() - now.getTime() < RENEW_WITHIN_MS;
}

/** Opens a session for a signed-in user. */
export async function createSession(db: DbOrTx, userId: number, now = new Date()) {
	const token = generateSessionToken();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
	await db.insert(appSession).values({ id: sessionIdFromToken(token), userId, expiresAt });
	return { token, expiresAt };
}

/** Returns the user of a valid session, extending it when it is close to expiry. */
export async function validateSessionToken(
	db: DbOrTx,
	token: string,
	now = new Date()
): Promise<{ user: SessionUser; session: SessionInfo; renewed: boolean } | null> {
	const id = sessionIdFromToken(token);
	const [row] = await db
		.select({
			expiresAt: appSession.expiresAt,
			user: {
				id: appUser.id,
				email: appUser.email,
				name: appUser.name,
				avatarUrl: appUser.avatarUrl,
				role: appUser.role,
				status: appUser.status,
				officialId: appUser.officialId,
				requestedOfficialId: appUser.requestedOfficialId,
				groupId: official.groupId,
				firstName: official.firstName,
				lastName: official.lastName,
				homeAddress: appUser.homeAddress,
				homeLat: appUser.homeLat,
				homeLon: appUser.homeLon,
				homeMunicipality: appUser.homeMunicipality
			}
		})
		.from(appSession)
		.innerJoin(appUser, eq(appUser.id, appSession.userId))
		.leftJoin(official, eq(official.id, appUser.officialId))
		.where(eq(appSession.id, id));
	if (!row) return null;
	if (row.expiresAt.getTime() <= now.getTime()) {
		await db.delete(appSession).where(eq(appSession.id, id));
		return null;
	}
	let expiresAt = row.expiresAt;
	const renewed = shouldRenew(expiresAt, now);
	if (renewed) {
		expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
		await db.update(appSession).set({ expiresAt }).where(eq(appSession.id, id));
	}
	return {
		user: row.user,
		session: { id, expiresAt },
		renewed
	};
}

export async function invalidateSession(db: DbOrTx, token: string) {
	await db.delete(appSession).where(eq(appSession.id, sessionIdFromToken(token)));
}

export async function deleteExpiredSessions(db: DbOrTx, now = new Date()) {
	await db.delete(appSession).where(sql`${appSession.expiresAt} <= ${now}`);
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date) {
	// httpOnly and secure (outside dev) are SvelteKit defaults
	cookies.set(SESSION_COOKIE, token, { path: '/', sameSite: 'lax', expires: expiresAt });
}

export function deleteSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
