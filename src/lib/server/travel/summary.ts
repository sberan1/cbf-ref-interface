/** Allowances of a person's game days, for the trips page and the dashboard. */
import type { DbOrTx } from '../db/client';
import type { DayAllowance } from './allowances';
import {
	dayAllowance,
	gameDays,
	loadTrips,
	type GameDay,
	type Home,
	type StoredTrip
} from './trips';

export interface DayRow {
	day: GameDay;
	trip: StoredTrip | null;
	allowance: DayAllowance | null;
}

export async function personDays(
	db: DbOrTx,
	userId: number,
	officialIds: number[],
	home: Home | null,
	range: { from?: string; to?: string; dates?: string[] } = {}
): Promise<DayRow[]> {
	const days = await gameDays(db, officialIds, range);
	const trips = await loadTrips(
		db,
		userId,
		days.map((d) => d.date)
	);
	return days.map((day) => {
		const trip = trips.get(day.date) ?? null;
		return { day, trip, allowance: trip ? dayAllowance(day, trip, home) : null };
	});
}

export interface AllowanceTotals {
	days: number;
	filled: number;
	confirmed: number;
	km: number;
	travel: number;
	meal: number;
	weekday: number;
	total: number;
	estimated: number;
}

export function totals(rows: DayRow[]): AllowanceTotals {
	const t: AllowanceTotals = {
		days: rows.length,
		filled: 0,
		confirmed: 0,
		km: 0,
		travel: 0,
		meal: 0,
		weekday: 0,
		total: 0,
		estimated: 0
	};
	for (const r of rows) {
		if (!r.allowance || !r.trip) continue;
		t.filled++;
		if (r.trip.status === 'confirmed') t.confirmed++;
		t.km += r.allowance.mode === 'car' ? r.allowance.km.alone + r.allowance.km.shared : 0;
		t.travel += r.allowance.travel;
		t.meal += r.allowance.meal;
		t.weekday += r.allowance.weekday;
		t.total += r.allowance.total;
		if (r.allowance.estimated || r.trip.status === 'auto') t.estimated += r.allowance.total;
	}
	t.km = Math.round(t.km * 10) / 10;
	return t;
}
