/**
 * Games refereed outside the ČBF system (friendlies, local tournaments), entered by hand for the
 * user's own records (PDR 0004). They count in the earnings (fee as paid, never an estimate) and
 * in the calendar-year export, but not in the ČBF game statistics.
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { appOwnGame, ownGameRoles, type OwnGameRole } from '../db/schema';

export const ownGameRoleNames: Record<OwnGameRole, string> = {
	referee: 'rozhodčí',
	commissioner: 'komisař',
	table: 'stolek',
	other: 'jiné'
};

const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((v) => v || null);

/** Form input; empty fee = unpaid or not known yet. */
export const ownGameSchema = z.object({
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'Zadej datum.')
		.refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Neplatné datum.'),
	title: z.string().trim().min(1, 'Zadej, o co šlo (např. přátelák nebo turnaj).').max(200),
	role: z.enum(ownGameRoles),
	games: z.coerce.number().int().min(1).max(50),
	fee: z
		.union([z.literal(''), z.coerce.number().int().min(0).max(1_000_000)])
		.transform((v) => (v === '' ? null : v)),
	place: optionalText(200),
	note: optionalText(500)
});
export type OwnGameInput = z.infer<typeof ownGameSchema>;

export interface OwnGame extends OwnGameInput {
	id: number;
}

export async function listOwnGames(db: DbOrTx, userId: number): Promise<OwnGame[]> {
	return db
		.select({
			id: appOwnGame.id,
			date: appOwnGame.date,
			title: appOwnGame.title,
			role: appOwnGame.role,
			games: appOwnGame.games,
			fee: appOwnGame.fee,
			place: appOwnGame.place,
			note: appOwnGame.note
		})
		.from(appOwnGame)
		.where(eq(appOwnGame.userId, userId))
		.orderBy(desc(appOwnGame.date), desc(appOwnGame.id));
}

/** Inserts, or updates the user's own entry `id`; false when `id` is not theirs. */
export async function saveOwnGame(
	db: DbOrTx,
	userId: number,
	input: OwnGameInput,
	id?: number
): Promise<boolean> {
	if (id === undefined) {
		await db.insert(appOwnGame).values({ ...input, userId });
		return true;
	}
	const updated = await db
		.update(appOwnGame)
		.set({ ...input, updatedAt: new Date() })
		.where(and(eq(appOwnGame.id, id), eq(appOwnGame.userId, userId)))
		.returning({ id: appOwnGame.id });
	return updated.length > 0;
}

export async function deleteOwnGame(db: DbOrTx, userId: number, id: number) {
	await db.delete(appOwnGame).where(and(eq(appOwnGame.id, id), eq(appOwnGame.userId, userId)));
}
