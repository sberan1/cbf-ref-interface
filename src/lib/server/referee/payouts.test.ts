import { describe, expect, it } from 'vitest';
import type { GameFee } from '../fees';
import type { DayAllowance } from '../travel/allowances';
import type { DayRow } from '../travel/summary';
import type { DayGameDetail, StoredTrip } from '../travel/trips';
import { payoutDays } from './payouts';

const game = (gameId: number, role = 'referee1'): DayGameDetail =>
	({
		gameId,
		role,
		startsAt: null,
		scheduledTime: null,
		seasonYear: 2026,
		homeTeam: 'Žižkov Falcons B',
		awayTeam: 'Stavební fakulta A',
		areaId: 1,
		isFemale: false,
		leagueName: 'Oblasti',
		competitionName: 'Přebor A',
		categoryName: 'muži',
		phaseName: null,
		round: null,
		venueMunicipality: 'Praha 3',
		venue: {
			id: 1,
			name: 'TJ Sokol Žižkov I.',
			street: null,
			city: 'Praha 3',
			lat: null,
			lon: null
		},
		colleagues: []
	}) as DayGameDetail;

const fee = (amount: number | null): GameFee =>
	(amount === null
		? { amount: null, key: null, label: null, reason: 'odměny komisařů v přehledu nejsou' }
		: {
				amount,
				key: 'praha.preborA',
				label: 'Přebor A',
				scheduleId: 'praha-2026',
				provenance: 'document',
				note: null,
				singleReferee: false
			}) as GameFee;

const allowance: DayAllowance = {
	mode: 'car',
	km: { alone: 30, shared: 12 },
	rates: { alone: 4.5, shared: 5 },
	mileage: 195,
	tickets: 0,
	extra: 50,
	travel: 245,
	minutes: { driving: 70, games: 420 },
	meal: 155,
	mealNote: null,
	weekday: 0,
	weekdayNote: 'víkend',
	total: 400,
	estimated: false,
	ratesAssumed: false,
	notes: []
};

describe('payoutDays', () => {
	it('splits a day into fees per game, trip and allowances, own games included', () => {
		const rows: DayRow[] = [
			{
				day: { date: '2026-10-24', seasonYear: 2026, games: [game(1), game(2, 'commissioner')] },
				trip: { status: 'confirmed', mode: 'car' } as StoredTrip,
				allowance
			},
			{
				day: { date: '2026-10-31', seasonYear: 2026, games: [game(3)] },
				trip: null,
				allowance: null
			}
		];
		const fees = new Map([
			['1:referee1', fee(600)],
			['2:commissioner', fee(null)],
			['3:referee1', fee(600)]
		]);
		const own = [
			{
				id: 9,
				date: '2026-10-24',
				title: 'Turnaj U11',
				role: 'referee' as const,
				games: 3,
				fee: 900,
				place: null,
				note: null
			},
			{
				id: 8,
				date: '2026-10-11',
				title: 'Přátelák',
				role: 'referee' as const,
				games: 1,
				fee: 500,
				place: null,
				note: null
			}
		];
		const days = payoutDays(rows, fees, own, '2026-10-27');

		expect(days.map((d) => d.date)).toEqual(['2026-10-31', '2026-10-24', '2026-10-11']);
		const sat = days[1];
		expect(sat.games.map((g) => [g.role, g.fee, g.feeNote])).toEqual([
			['1. rozhodčí', 600, 'Přebor A'],
			['komisař', null, 'odměny komisařů v přehledu nejsou']
		]);
		expect(sat.trip).toMatchObject({
			mileage: 195,
			extra: 50,
			meal: 155,
			minutes: 490,
			confirmed: true
		});
		expect(sat).toMatchObject({ fees: 1500, allowances: 400, total: 1900, upcoming: false });
		expect(days[0]).toMatchObject({ trip: null, fees: 600, total: 600, upcoming: true });
		expect(days[2]).toMatchObject({ games: [], fees: 500, total: 500 });
	});
});
