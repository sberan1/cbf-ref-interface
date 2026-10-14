import { fail, redirect } from '@sveltejs/kit';
import { PairingError, requestPairing } from '#lib/server/auth/accounts.ts';
import { landingPath, requireUser } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { searchOfficials } from '#lib/server/referee/queries.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals.user);
	if (user.status === 'approved' && user.officialId !== null) redirect(303, landingPath(user));
	const q = (url.searchParams.get('q') ?? '').slice(0, 100);
	return {
		q,
		account: user.email,
		results: q.trim().length >= 2 ? await searchOfficials(getDb(), q) : []
	};
};

export const actions: Actions = {
	request: async ({ locals, request }) => {
		const user = requireUser(locals.user);
		const officialId = Number((await request.formData()).get('officialId'));
		if (!Number.isInteger(officialId) || officialId <= 0) {
			return fail(400, { error: 'Vybraný rozhodčí v databázi není.' });
		}
		try {
			await requestPairing(getDb(), user, officialId);
		} catch (err) {
			if (err instanceof PairingError) return fail(400, { error: err.message });
			throw err;
		}
		redirect(303, user.role === 'admin' ? '/dashboard' : '/pending');
	}
};
