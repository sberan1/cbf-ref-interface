import { fail, redirect } from '@sveltejs/kit';
import { pairAndCreateSession, setSessionCookie } from '#lib/server/auth/session.ts';
import { db } from '#lib/server/db/index.ts';
import { officialExists, searchOfficials } from '#lib/server/referee/queries.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, '/dashboard');
	const q = (url.searchParams.get('q') ?? '').slice(0, 100);
	return { q, results: q.trim().length >= 2 ? await searchOfficials(db, q) : [] };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const officialId = Number(form.get('officialId'));
		if (
			!Number.isInteger(officialId) ||
			officialId <= 0 ||
			!(await officialExists(db, officialId))
		) {
			return fail(400, { error: 'Vybraný rozhodčí v databázi není.' });
		}
		const { token, expiresAt } = await pairAndCreateSession(db, officialId);
		setSessionCookie(cookies, token, expiresAt);
		redirect(303, '/dashboard');
	}
};
