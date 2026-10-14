import { redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import {
	competitionBreakdown,
	currentSeasonStartYear,
	gamesTimeline,
	personGames,
	personOfficialIds,
	pragueToday,
	refereeSummary,
	topColleagues
} from '#lib/server/referee/queries.ts';
import { isGranularity } from '#lib/referee/timeline.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	const g = url.searchParams.get('g');
	const granularity = isGranularity(g) ? g : 'season';
	const db = getDb();
	const now = new Date();
	const today = pragueToday(now);
	const currentSeasonYear = await currentSeasonStartYear(db, now);
	const ids = await personOfficialIds(db, locals.user);

	const [summary, timeline, upcoming, recent, competitions, colleagues] = await Promise.all([
		refereeSummary(db, ids, { today, currentSeasonYear }),
		gamesTimeline(db, ids, granularity, { now, currentSeasonYear }),
		personGames(db, ids, { direction: 'next', today, limit: 8 }),
		personGames(db, ids, { direction: 'previous', today, limit: 8 }),
		competitionBreakdown(db, ids, 10),
		topColleagues(db, ids, 5)
	]);

	return {
		granularity,
		currentSeasonYear,
		summary,
		timeline,
		upcoming,
		recent,
		competitions,
		colleagues
	};
};
