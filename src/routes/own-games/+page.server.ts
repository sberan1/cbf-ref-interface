import { fail } from '@sveltejs/kit';
import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { log } from '#lib/server/log.ts';
import {
	deleteOwnGame,
	listOwnGames,
	ownGameSchema,
	saveOwnGame
} from '#lib/server/referee/own-games.ts';
import { pragueToday } from '#lib/server/referee/queries.ts';
import type { Actions, PageServerLoad } from './$types';

const idOf = (v: FormDataEntryValue | null) =>
	typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : undefined;

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireApproved(locals.user);
	return { games: await listOwnGames(getDb(), user.id), today: pragueToday() };
};

export const actions: Actions = {
	save: async ({ locals, request }) => {
		const user = requireApproved(locals.user);
		const form = await request.formData();
		const values = Object.fromEntries(
			['date', 'title', 'role', 'games', 'fee', 'place', 'note'].map((k) => [
				k,
				String(form.get(k) ?? '')
			])
		);
		const parsed = ownGameSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Chyba.', values });
		}
		const id = idOf(form.get('id'));
		if (!(await saveOwnGame(getDb(), user.id, parsed.data, id))) {
			return fail(404, { error: 'Zápas nebyl nalezen.', values });
		}
		log.info('own game saved', { userId: user.id, created: id === undefined });
		return { saved: true };
	},
	delete: async ({ locals, request }) => {
		const user = requireApproved(locals.user);
		const id = idOf((await request.formData()).get('id'));
		if (id !== undefined) await deleteOwnGame(getDb(), user.id, id);
		return { deleted: true };
	}
};
