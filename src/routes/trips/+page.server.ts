import { fail } from '@sveltejs/kit';
import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import {
	currentSeasonStartYear,
	personOfficialIds,
	pragueToday
} from '#lib/server/referee/queries.ts';
import { holidayName } from '#lib/server/travel/holidays.ts';
import { getMaps, homeOf } from '#lib/server/travel/service.ts';
import { personDays, totals } from '#lib/server/travel/summary.ts';
import { autoFill, gameDays } from '#lib/server/travel/trips.ts';
import type { Actions, PageServerLoad } from './$types';

const modeLabel = {
	car: 'autem',
	passenger: 'spolujezdec',
	public: 'veřejná doprava',
	none: 'bez cesty'
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireApproved(locals.user);
	const db = getDb();
	const ids = await personOfficialIds(db, user);
	const home = homeOf(user);
	const all = await personDays(db, user.id, ids, home);
	const seasons = [...new Set(all.map((r) => r.day.seasonYear).filter((y) => y !== null))].sort(
		(a, b) => b - a
	) as number[];
	const requested = Number(url.searchParams.get('s'));
	const current = await currentSeasonStartYear(db);
	const season = seasons.includes(requested)
		? requested
		: seasons.includes(current)
			? current
			: (seasons[0] ?? null);
	const rows = all.filter((r) => r.day.seasonYear === season).reverse();
	const today = pragueToday();

	return {
		season,
		seasons,
		hasHome: home !== null,
		mapsLive: getMaps(db).live,
		totals: totals(rows),
		days: rows.map(({ day, trip, allowance }) => {
			const pickups = trip?.stops.filter((s) => s.kind === 'pickup') ?? [];
			return {
				date: day.date,
				upcoming: day.date > today,
				holiday: holidayName(day.date) ?? null,
				games: day.games.map((g) => ({
					id: g.gameId,
					time: g.startsAt,
					competition: g.competitionName,
					venue: [g.venue.name, g.venue.city].filter(Boolean).join(', '),
					commissioner: g.role === 'commissioner'
				})),
				status: trip?.status ?? null,
				summary: trip
					? [
							modeLabel[trip.mode],
							pickups.length
								? `s ${pickups.map((p) => p.colleague || 'kolegou').join(', ')}`
								: trip.mode === 'car'
									? 'sám'
									: null
						]
							.filter(Boolean)
							.join(' ')
					: null,
				allowance
			};
		})
	};
};

export const actions: Actions = {
	autofill: async ({ locals, request }) => {
		const user = requireApproved(locals.user);
		const home = homeOf(user);
		if (!home) return fail(400, { error: 'Nejdřív si v profilu nastav bydliště.' });
		const season = Number((await request.formData()).get('season'));
		const db = getDb();
		const ids = await personOfficialIds(db, user);
		const days = (await gameDays(db, ids)).filter((d) => d.seasonYear === season);
		const result = await autoFill(db, getMaps(db), user.id, home, days);
		return { autofill: result };
	}
};
