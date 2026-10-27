import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { feeIndex, personFees } from '#lib/server/referee/earnings.ts';
import { listOwnGames } from '#lib/server/referee/own-games.ts';
import { payoutDays } from '#lib/server/referee/payouts.ts';
import { personOfficialIds, pragueToday } from '#lib/server/referee/queries.ts';
import { homeOf } from '#lib/server/travel/service.ts';
import { personDays } from '#lib/server/travel/summary.ts';
import type { PageServerLoad } from './$types';

/** Vyúčtování (PDR 0005): one card per game day of a month (?m=YYYY-MM). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireApproved(locals.user);
	const db = getDb();
	const today = pragueToday();
	const ids = await personOfficialIds(db, user);
	const [rows, fees, own] = await Promise.all([
		personDays(db, user.id, ids, homeOf(user)),
		personFees(db, ids, today),
		listOwnGames(db, user.id)
	]);

	const months = [
		...new Set(
			[...rows.map((r) => r.day.date), ...own.map((g) => g.date)].map((d) => d.slice(0, 7))
		)
	].sort((a, b) => b.localeCompare(a));
	const requested = url.searchParams.get('m');
	const thisMonth = today.slice(0, 7);
	// the requested month, else this month, else the latest month that already started
	const month =
		(requested && months.includes(requested) ? requested : null) ??
		(months.includes(thisMonth) ? thisMonth : null) ??
		months.find((m) => m <= thisMonth) ??
		months[0] ??
		null;

	const inMonth = (date: string) => month !== null && date.startsWith(`${month}-`);
	const days = payoutDays(
		rows.filter((r) => inMonth(r.day.date)),
		feeIndex(fees),
		own.filter((g) => inMonth(g.date)),
		today
	);
	return {
		months,
		month,
		days,
		hasHome: homeOf(user) !== null,
		totals: {
			fees: days.reduce((s, d) => s + d.fees, 0),
			allowances: days.reduce((s, d) => s + d.allowances, 0),
			total: days.reduce((s, d) => s + d.total, 0),
			missingTrips: days.filter((d) => d.games.length > 0 && d.trip === null).length
		}
	};
};
