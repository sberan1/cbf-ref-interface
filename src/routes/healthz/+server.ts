import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.ts';
import type { RequestHandler } from './$types';

/** Liveness + DB check for Docker healthchecks and the deploy smoke test. */
export const GET: RequestHandler = async () => {
	try {
		await getDb().execute(sql`select 1`);
		return json({ ok: true });
	} catch {
		return json({ ok: false }, { status: 503 });
	}
};
