/**
 * Accounts (ADR 0008): sign-in with Google creates the account, the person then asks to be
 * paired with their official record and an admin approves it. Admins are listed in
 * `ADMIN_EMAILS`; their own pairing needs no approval.
 */
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { appOAuthAccount, appUser, official } from '../db/schema';

export interface GoogleProfile {
	sub: string;
	email: string;
	name: string | null;
	picture: string | null;
}

export function parseAdminEmails(value: string | undefined): Set<string> {
	return new Set(
		(value ?? '')
			.split(',')
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean)
	);
}

/** Finds or creates the account of a Google identity; the role follows `ADMIN_EMAILS`. */
export async function signInWithGoogle(
	db: DbOrTx,
	profile: GoogleProfile,
	adminEmails: Set<string>,
	now = new Date()
): Promise<number> {
	const email = profile.email.trim().toLowerCase();
	const role = adminEmails.has(email) ? 'admin' : 'user';
	return db.transaction(async (tx) => {
		const [linked] = await tx
			.select({ userId: appOAuthAccount.userId })
			.from(appOAuthAccount)
			.where(
				and(eq(appOAuthAccount.provider, 'google'), eq(appOAuthAccount.providerUserId, profile.sub))
			);
		let userId = linked?.userId;
		if (userId === undefined) {
			// same e-mail as an existing account (e.g. created before the Google ID was linked)
			const [byEmail] = await tx
				.select({ id: appUser.id })
				.from(appUser)
				.where(eq(appUser.email, email));
			userId =
				byEmail?.id ??
				(
					await tx
						.insert(appUser)
						.values({ email, name: profile.name, avatarUrl: profile.picture, role })
						.returning({ id: appUser.id })
				)[0].id;
			await tx
				.insert(appOAuthAccount)
				.values({ provider: 'google', providerUserId: profile.sub, userId, email })
				.onConflictDoNothing();
		}
		await tx
			.update(appUser)
			.set({ name: profile.name, avatarUrl: profile.picture, role, lastLoginAt: now })
			.where(eq(appUser.id, userId));
		return userId;
	});
}

export class PairingError extends Error {}

/**
 * "To jsem já": asks to be paired with an official. Admins are approved at once; everybody else
 * waits for an admin. An official already paired with another account cannot be requested.
 */
export async function requestPairing(
	db: DbOrTx,
	user: { id: number; role: string },
	officialId: number,
	now = new Date()
) {
	const [target] = await db
		.select({ id: official.id })
		.from(official)
		.where(eq(official.id, officialId));
	if (!target) throw new PairingError('Vybraný rozhodčí v databázi není.');
	const [taken] = await db
		.select({ id: appUser.id })
		.from(appUser)
		.where(and(eq(appUser.officialId, officialId), ne(appUser.id, user.id)));
	if (taken) {
		throw new PairingError('Tento rozhodčí už je spárovaný s jiným účtem. Kontaktuj správce.');
	}
	const admin = user.role === 'admin';
	await db
		.update(appUser)
		.set({
			requestedOfficialId: officialId,
			requestedAt: now,
			status: admin ? 'approved' : 'pending',
			officialId: admin ? officialId : null,
			reviewedAt: admin ? now : null,
			reviewedByUserId: admin ? user.id : null
		})
		.where(eq(appUser.id, user.id));
}

export type ReviewDecision = 'approve' | 'reject' | 'revoke';

/** Admin decision on an account; `approve` pairs it with `officialId` or the requested one. */
export async function reviewAccount(
	db: DbOrTx,
	adminId: number,
	userId: number,
	decision: ReviewDecision,
	officialId?: number,
	now = new Date()
) {
	const [user] = await db
		.select({ requestedOfficialId: appUser.requestedOfficialId })
		.from(appUser)
		.where(eq(appUser.id, userId));
	if (!user) throw new PairingError('Účet neexistuje.');
	if (decision === 'approve') {
		const target = officialId ?? user.requestedOfficialId;
		if (!target) throw new PairingError('Účet nemá vybraného rozhodčího.');
		const [taken] = await db
			.select({ id: appUser.id })
			.from(appUser)
			.where(and(eq(appUser.officialId, target), ne(appUser.id, userId)));
		if (taken) throw new PairingError(`Rozhodčí ${target} už je spárovaný s jiným účtem.`);
		const [exists] = await db
			.select({ id: official.id })
			.from(official)
			.where(eq(official.id, target));
		if (!exists) throw new PairingError(`Rozhodčí ${target} v databázi není.`);
		await db
			.update(appUser)
			.set({
				status: 'approved',
				officialId: target,
				requestedOfficialId: target,
				reviewedAt: now,
				reviewedByUserId: adminId
			})
			.where(eq(appUser.id, userId));
		return;
	}
	await db
		.update(appUser)
		.set({
			status: decision === 'reject' ? 'rejected' : 'pending',
			officialId: null,
			reviewedAt: now,
			reviewedByUserId: adminId
		})
		.where(eq(appUser.id, userId));
}

export interface AccountRow {
	id: number;
	email: string;
	name: string | null;
	role: string;
	status: string;
	createdAt: Date;
	lastLoginAt: Date;
	requestedAt: Date | null;
	requested: { id: number | null; name: string | null };
	paired: { id: number | null; name: string | null };
}

/** All accounts for the admin page, those waiting for a decision first. */
export async function listAccounts(db: DbOrTx): Promise<AccountRow[]> {
	const req = sql`(select coalesce(o.first_name || ' ', '') || coalesce(o.last_name, '') from ${official} o where o.id = ${appUser.requestedOfficialId})`;
	const paired = sql`(select coalesce(o.first_name || ' ', '') || coalesce(o.last_name, '') from ${official} o where o.id = ${appUser.officialId})`;
	const rows = await db
		.select({
			id: appUser.id,
			email: appUser.email,
			name: appUser.name,
			role: appUser.role,
			status: appUser.status,
			createdAt: appUser.createdAt,
			lastLoginAt: appUser.lastLoginAt,
			requestedAt: appUser.requestedAt,
			requestedId: appUser.requestedOfficialId,
			requestedName: sql<string | null>`${req}`,
			pairedId: appUser.officialId,
			pairedName: sql<string | null>`${paired}`
		})
		.from(appUser)
		.orderBy(
			sql`case when ${appUser.status} = 'pending' and ${appUser.requestedOfficialId} is not null then 0 else 1 end`,
			desc(appUser.requestedAt),
			asc(appUser.email)
		);
	return rows.map(({ requestedId, requestedName, pairedId, pairedName, ...r }) => ({
		...r,
		requested: { id: requestedId, name: requestedName },
		paired: { id: pairedId, name: pairedName }
	}));
}
