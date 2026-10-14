import { redirect } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	invalidateSession
} from '#lib/server/auth/session.ts';
import { getDb } from '#lib/server/db/index.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await invalidateSession(getDb(), token);
		deleteSessionCookie(cookies);
		redirect(303, '/login');
	}
};
