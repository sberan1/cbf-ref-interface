import { json } from '@sveltejs/kit';
import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { getMaps } from '#lib/server/travel/service.ts';
import type { RequestHandler } from './$types';

/** Address suggestions for the trip wizard; keeps the Mapy.com key on the server. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireApproved(locals.user);
	const q = (url.searchParams.get('q') ?? '').slice(0, 120);
	try {
		return json(await getMaps(getDb()).suggest(q));
	} catch (err) {
		console.warn('suggest failed', err instanceof Error ? err.message : err);
		return json([]);
	}
};
