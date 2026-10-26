import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { official } from '#lib/server/db/schema/index.ts';
import { feeIndex, personFees } from '#lib/server/referee/earnings.ts';
import { feeView } from '#lib/server/referee/fee-view.ts';
import {
	personGames,
	personOfficialIds,
	pragueToday,
	teamCondition,
	type GamesFilter
} from '#lib/server/referee/queries.ts';
import type { PageServerLoad } from './$types';

const intParam = (url: URL, name: string) => {
	const v = url.searchParams.get(name);
	return v !== null && /^\d{1,9}$/.test(v) ? Number(v) : undefined;
};

/**
 * The person's games with one colleague (?kolega=<official id>) or against one team
 * (?tym=<TeamRow.key>), optionally within a season (?ks) and area (?ko) like the dashboard.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireApproved(locals.user);
	const db = getDb();
	const today = pragueToday();
	const ids = await personOfficialIds(db, user);
	const filter: GamesFilter = { seasonYear: intParam(url, 'ks'), areaId: intParam(url, 'ko') };
	let title: string;
	let kind: 'colleague' | 'team';

	const colleagueId = intParam(url, 'kolega');
	const teamKey = url.searchParams.get('tym');
	if (colleagueId !== undefined) {
		const [o] = await db
			.select({
				id: official.id,
				groupId: official.groupId,
				firstName: official.firstName,
				lastName: official.lastName
			})
			.from(official)
			.where(eq(official.id, colleagueId));
		if (!o) error(404, 'Kolega nenalezen');
		filter.withOfficialIds = (
			await personOfficialIds(db, { officialId: o.id, groupId: o.groupId })
		).filter((id) => !ids.includes(id));
		if (!filter.withOfficialIds.length) error(404, 'Kolega nenalezen');
		title = [o.firstName, o.lastName].filter(Boolean).join(' ') || 'Kolega';
		kind = 'colleague';
	} else if (teamKey) {
		const condition = teamCondition(teamKey);
		if (!condition) error(404, 'Tým nenalezen');
		filter.team = condition;
		title = url.searchParams.get('nazev')?.slice(0, 200) || 'Tým';
		kind = 'team';
	} else {
		error(404, 'Chybí kolega nebo tým');
	}

	const [games, fees] = await Promise.all([
		personGames(db, ids, { direction: 'all', today, limit: 2000, filter }),
		personFees(db, ids, today)
	]);
	const index = feeIndex(fees);
	const rows = games.map((g) => ({ ...g, fee: feeView(index.get(`${g.id}:${g.roleCode}`)) }));
	const played = rows.filter((g) => g.scheduledDate !== null && g.scheduledDate < today);
	return {
		kind,
		title,
		season: filter.seasonYear ?? null,
		area: filter.areaId ?? null,
		upcoming: rows.filter((g) => !played.includes(g)).reverse(),
		played,
		stats: {
			games: new Set(rows.map((g) => g.id)).size,
			referee: new Set(rows.filter((g) => g.role === 'referee').map((g) => g.id)).size,
			commissioner: new Set(rows.filter((g) => g.role === 'commissioner').map((g) => g.id)).size,
			earned: played.reduce((sum, g) => sum + (g.fee?.amount ?? 0), 0),
			seasons: [...new Set(rows.map((g) => g.seasonYear))]
				.filter((y): y is number => y !== null)
				.sort((a, b) => a - b)
		}
	};
};
