import { error } from '@sveltejs/kit';
import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { personFees } from '#lib/server/referee/earnings.ts';
import { listOwnGames } from '#lib/server/referee/own-games.ts';
import { personOfficialIds, pragueToday } from '#lib/server/referee/queries.ts';
import { yearCsv } from '#lib/server/referee/year-export.ts';
import { homeOf } from '#lib/server/travel/service.ts';
import { personDays } from '#lib/server/travel/summary.ts';
import type { RequestHandler } from './$types';

/** CSV of one calendar year: fees of played games, own games and allowances (PDR 0004). */
export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireApproved(locals.user);
	if (!/^\d{4}$/.test(params.year)) error(404, 'Neplatný rok');
	const year = Number(params.year);
	const db = getDb();
	const today = pragueToday();
	const ids = await personOfficialIds(db, user);
	const [fees, days, own] = await Promise.all([
		personFees(db, ids, today),
		personDays(db, user.id, ids, homeOf(user), { from: `${year}-01-01`, to: `${year}-12-31` }),
		listOwnGames(db, user.id)
	]);
	return new Response(yearCsv(year, fees, days, own, today), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="odmeny-${year}.csv"`,
			'cache-control': 'private, no-store'
		}
	});
};
