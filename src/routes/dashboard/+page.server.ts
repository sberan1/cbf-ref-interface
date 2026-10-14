import { redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import type { GameFee } from '#lib/server/fees/index.ts';
import {
	earningsTimeline,
	feeIndex,
	personFees,
	summarizeEarnings
} from '#lib/server/referee/earnings.ts';
import {
	competitionBreakdown,
	currentSeasonStartYear,
	gamesTimeline,
	personGames,
	personOfficialIds,
	pragueToday,
	refereeSummary,
	topColleagues,
	type GameRow
} from '#lib/server/referee/queries.ts';
import { isGranularity } from '#lib/referee/timeline.ts';
import type { PageServerLoad } from './$types';

/** What the game lists show about a fee: amount, or why there is none. */
function feeView(fee: GameFee | undefined) {
	if (!fee) return null;
	if (fee.amount === null) return { amount: null, estimate: false, detail: fee.reason };
	return {
		amount: fee.amount,
		estimate: fee.provenance === 'assumed',
		detail: [fee.label, fee.singleReferee ? '1,5× jeden rozhodčí' : null, fee.note]
			.filter(Boolean)
			.join(' · ')
	};
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	const g = url.searchParams.get('g');
	const granularity = isGranularity(g) ? g : 'season';
	const metric: 'games' | 'earnings' = url.searchParams.get('m') === 'kc' ? 'earnings' : 'games';
	const db = getDb();
	const now = new Date();
	const today = pragueToday(now);
	const currentSeasonYear = await currentSeasonStartYear(db, now);
	const ids = await personOfficialIds(db, locals.user);

	const [summary, timeline, upcoming, recent, competitions, colleagues, fees] = await Promise.all([
		refereeSummary(db, ids, { today, currentSeasonYear }),
		metric === 'games' ? gamesTimeline(db, ids, granularity, { now, currentSeasonYear }) : null,
		personGames(db, ids, { direction: 'next', today, limit: 8 }),
		personGames(db, ids, { direction: 'previous', today, limit: 8 }),
		competitionBreakdown(db, ids, 10),
		topColleagues(db, ids, 5),
		personFees(db, ids, today)
	]);

	const index = feeIndex(fees);
	const withFees = (games: GameRow[]) =>
		games.map((game) => ({ ...game, fee: feeView(index.get(`${game.id}:${game.roleCode}`)) }));

	return {
		granularity,
		metric,
		currentSeasonYear,
		summary,
		timeline: timeline ?? earningsTimeline(fees, granularity, { now, currentSeasonYear }),
		upcoming: withFees(upcoming),
		recent: withFees(recent),
		competitions,
		colleagues,
		earnings: summarizeEarnings(fees, currentSeasonYear)
	};
};
