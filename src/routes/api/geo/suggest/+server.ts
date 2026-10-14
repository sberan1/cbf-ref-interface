import { json } from '@sveltejs/kit';
import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { log } from '#lib/server/log.ts';
import { getMaps } from '#lib/server/travel/service.ts';
import type { RequestHandler } from './$types';

/** Address suggestions for the trip wizard; keeps the Mapy.com key on the server. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireApproved(locals.user);
	const q = (url.searchParams.get('q') ?? '').slice(0, 120);
	try {
		return json(await getMaps(getDb()).suggest(q));
	} catch (err) {
		log.warn('mapy suggest failed', { err: err instanceof Error ? err.message : String(err) });
		return json([]);
	}
};
