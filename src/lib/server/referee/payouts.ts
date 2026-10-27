/**
 * Payout screen (PDR 0005): per game day, what to fill in the payout form, split into the fee of
 * each game, mileage, receipts, meal and weekday allowance, from the fee schedules and the trip.
 */
import type { GameFee } from '../fees';
import type { DayRow } from '../travel/summary';
import { ownGameRoleNames, type OwnGame } from './own-games';
import { roleNames } from './queries';

export interface PayoutGame {
	id: number;
	teams: string;
	competition: string | null;
	category: string | null;
	venue: string | null;
	role: string;
	fee: number | null;
	/** fee label, or why there is no fee */
	feeNote: string | null;
	estimate: boolean;
}

export interface PayoutTrip {
	mode: 'car' | 'passenger' | 'public' | 'none';
	confirmed: boolean;
	kmAlone: number;
	kmShared: number;
	rateAlone: number;
	rateShared: number;
	mileage: number;
	tickets: number;
	extra: number;
	meal: number;
	minutes: number;
	mealNote: string | null;
	weekday: number;
	weekdayNote: string | null;
	estimated: boolean;
	notes: string[];
}

export interface PayoutDay {
	date: string;
	upcoming: boolean;
	games: PayoutGame[];
	own: { id: number; title: string; role: string; games: number; fee: number | null }[];
	/** null until a trip is computed for the day (Cesty a náhrady) */
	trip: PayoutTrip | null;
	fees: number;
	allowances: number;
	total: number;
}

export function payoutDays(
	rows: DayRow[],
	fees: Map<string, GameFee>,
	own: OwnGame[],
	today: string
): PayoutDay[] {
	const days = new Map<string, PayoutDay>();
	const empty = (date: string): PayoutDay => ({
		date,
		upcoming: date > today,
		games: [],
		own: [],
		trip: null,
		fees: 0,
		allowances: 0,
		total: 0
	});

	for (const { day, trip, allowance: a } of rows) {
		const d = empty(day.date);
		for (const g of day.games) {
			const fee = fees.get(`${g.gameId}:${g.role}`);
			const amount = fee?.amount ?? null;
			d.games.push({
				id: g.gameId,
				teams: [g.homeTeam, g.awayTeam].filter(Boolean).join(' – ') || 'zápas',
				competition: g.competitionName,
				category: g.categoryName,
				venue: [g.venue.name, g.venue.city].filter(Boolean).join(', ') || null,
				role: roleNames[g.role] ?? g.role,
				fee: amount,
				feeNote: fee ? (fee.amount === null ? fee.reason : fee.label) : null,
				estimate: fee?.amount != null && fee.provenance === 'assumed'
			});
			d.fees += amount ?? 0;
		}
		if (trip && a) {
			d.trip = {
				mode: trip.mode,
				confirmed: trip.status === 'confirmed',
				kmAlone: a.km.alone,
				kmShared: a.km.shared,
				rateAlone: a.rates.alone,
				rateShared: a.rates.shared,
				mileage: a.mileage,
				tickets: a.tickets,
				extra: a.extra,
				meal: a.meal,
				minutes: a.minutes.driving + a.minutes.games,
				mealNote: a.mealNote,
				weekday: a.weekday,
				weekdayNote: a.weekdayNote,
				estimated: a.estimated,
				notes: a.notes
			};
			d.allowances = a.total;
		}
		days.set(day.date, d);
	}

	for (const g of own) {
		const d = days.get(g.date) ?? empty(g.date);
		d.own.push({
			id: g.id,
			title: g.title,
			role: ownGameRoleNames[g.role],
			games: g.games,
			fee: g.fee
		});
		d.fees += g.fee ?? 0;
		days.set(g.date, d);
	}

	return [...days.values()]
		.map((d) => ({ ...d, total: d.fees + d.allowances }))
		.sort((a, b) => b.date.localeCompare(a.date));
}
