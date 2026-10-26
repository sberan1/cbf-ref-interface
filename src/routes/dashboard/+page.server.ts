import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import {
	earningsTimeline,
	feeIndex,
	personFees,
	summarizeEarnings
} from '#lib/server/referee/earnings.ts';
import { feeView } from '#lib/server/referee/fee-view.ts';
import { listOwnGames } from '#lib/server/referee/own-games.ts';
import {
	colleagueFilterOptions,
	competitionBreakdown,
	currentSeasonStartYear,
	gamesTimeline,
	personGames,
	personOfficialIds,
	pragueToday,
	refereeSummary,
	teamBreakdown,
	topColleagues,
	type GameRow
} from '#lib/server/referee/queries.ts';
import { isGranularity } from '#lib/referee/timeline.ts';
import { homeOf } from '#lib/server/travel/service.ts';
import { personDays, totals } from '#lib/server/travel/summary.ts';
import type { PageServerLoad } from './$types';

const intParam = (url: URL, name: string) => {
	const v = url.searchParams.get(name);
	return v !== null && /^\d{1,4}$/.test(v) ? Number(v) : undefined;
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireApproved(locals.user);
	const g = url.searchParams.get('g');
	const granularity = isGranularity(g) ? g : 'season';
	const metric: 'games' | 'earnings' = url.searchParams.get('m') === 'kc' ? 'earnings' : 'games';
	const db = getDb();
	const now = new Date();
	const today = pragueToday(now);
	const currentSeasonYear = await currentSeasonStartYear(db, now);
	const ids = await personOfficialIds(db, user);

	// colleague leaderboard: ?ks=<season start year> and ?ko=<area>, both optional (all time)
	const options = await colleagueFilterOptions(db, ids, intParam(url, 'ks'));
	const colleagueSeason = options.seasons.find((y) => y === intParam(url, 'ks'));
	const colleagueArea = options.areas.find((a) => a.id === intParam(url, 'ko'))?.id;

	const [
		summary,
		timeline,
		upcoming,
		recent,
		competitions,
		colleagues,
		fees,
		days,
		ownGames,
		teams
	] = await Promise.all([
		refereeSummary(db, ids, { today, currentSeasonYear }),
		metric === 'games' ? gamesTimeline(db, ids, granularity, { now, currentSeasonYear }) : null,
		personGames(db, ids, { direction: 'next', today, limit: 8 }),
		personGames(db, ids, { direction: 'previous', today, limit: 8 }),
		competitionBreakdown(db, ids, 10),
		topColleagues(db, ids, undefined, { seasonYear: colleagueSeason, areaId: colleagueArea }),
		personFees(db, ids, today),
		personDays(db, user.id, ids, homeOf(user)),
		listOwnGames(db, user.id),
		teamBreakdown(db, ids)
	]);
	const own = { games: ownGames, today };

	const index = feeIndex(fees);
	const withFees = (games: GameRow[]) =>
		games.map((game) => ({ ...game, fee: feeView(index.get(`${game.id}:${game.roleCode}`)) }));

	return {
		granularity,
		metric,
		currentSeasonYear,
		summary,
		timeline: timeline ?? earningsTimeline(fees, granularity, { now, currentSeasonYear }, own),
		upcoming: withFees(upcoming),
		recent: withFees(recent),
		competitions,
		colleagues,
		teams,
		colleagueFilter: { season: colleagueSeason ?? null, area: colleagueArea ?? null, ...options },
		earnings: summarizeEarnings(fees, currentSeasonYear, own),
		allowances: {
			all: totals(days),
			currentSeason: totals(days.filter((d) => d.day.seasonYear === currentSeasonYear)),
			bySeason: Object.fromEntries(
				[...new Set(days.map((d) => d.day.seasonYear))]
					.filter((y): y is number => y !== null)
					.map((y) => [y, totals(days.filter((d) => d.day.seasonYear === y)).total])
			) as Record<number, number>,
			// calendar years of the past game days (tax return)
			byYear: Object.fromEntries(
				[...new Set(days.map((d) => Number(d.day.date.slice(0, 4))))].map((y) => [
					y,
					totals(days.filter((d) => d.day.date.startsWith(`${y}-`) && d.day.date <= today)).total
				])
			) as Record<number, number>
		}
	};
};
