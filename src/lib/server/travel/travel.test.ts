import { describe, expect, it } from 'vitest';
import {
	computeDayAllowance,
	passengersByLeg,
	type DayGame,
	type TripLeg,
	type TripStop
} from './allowances';
import { easterSunday, holidayName, isWorkday } from './holidays';
import { mapyProvider, straightLineRoute } from './mapy';
import { mealAmount, mealFor, mileageFor } from './rates';
import { defaultStops, venueStops, type GameDay } from './trips';

const km = (n: number, passengers = 0, minutes = n): TripLeg => ({
	meters: n * 1000,
	seconds: minutes * 60,
	passengers,
	approximate: false
});

const game = (over: Partial<DayGame> = {}): DayGame => ({
	gameId: 1,
	role: 'referee1',
	areaId: 1,
	isFemale: false,
	categoryName: 'muži',
	leagueName: 'Oblasti',
	competitionName: 'Přebor A',
	phaseName: null,
	round: null,
	venueMunicipality: 'Praha',
	...over
});

const national = game({
	areaId: 0,
	categoryName: 'muži',
	leagueName: '2. liga',
	competitionName: '2. liga mužů',
	venueMunicipality: 'Kolín'
});

describe('holidays', () => {
	it('computes Easter and the movable holidays', () => {
		expect(easterSunday(2025).toISOString().slice(0, 10)).toBe('2025-04-20');
		expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
		expect(holidayName('2026-04-03')).toBe('Velký pátek');
		expect(holidayName('2026-04-06')).toBe('Velikonoční pondělí');
		expect(holidayName('2026-10-28')).toMatch(/československého/);
	});

	it('knows workdays', () => {
		expect(isWorkday('2026-10-14')).toBe(true); // Wednesday
		expect(isWorkday('2026-10-17')).toBe(false); // Saturday
		expect(isWorkday('2026-10-28')).toBe(false); // holiday on a Wednesday
	});
});

describe('rates', () => {
	it('follows the overviews and the meal decree by calendar year', () => {
		expect(mileageFor('2026-10-10')).toMatchObject({ alone: 4.5, shared: 5, sharedTop: 6.3 });
		expect(mealAmount(mealFor('2026-10-10')!, 5)).toBe(155);
		expect(mealAmount(mealFor('2026-10-10')!, 4.99)).toBe(0);
		expect(mealAmount(mealFor('2026-10-10')!, 12.5)).toBe(236);
		expect(mealAmount(mealFor('2026-10-10')!, 19)).toBe(370);
		expect(mealAmount(mealFor('2025-11-01')!, 6)).toBe(148);
		expect(mealAmount(mealFor('2023-10-01')!, 6)).toBe(129);
		// MPSV decrees: 2017–2022 including the raise from 20. 8. 2022
		expect(mealFor('2017-11-04')!.tiers.map((t) => t.amount)).toEqual([72, 109, 171]);
		expect(mealFor('2021-03-01')!.tiers.map((t) => t.amount)).toEqual([91, 138, 217]);
		expect(mealFor('2022-08-19')!.tiers.map((t) => t.amount)).toEqual([99, 151, 237]);
		expect(mealFor('2022-08-20')!.tiers.map((t) => t.amount)).toEqual([120, 181, 284]);
		expect(mealFor('2024-05-01')!.tiers.map((t) => t.amount)).toEqual([140, 212, 333]);
		expect(mealFor('2016-12-31')).toBeUndefined();
	});
});

describe('passengersByLeg', () => {
	it('counts colleagues between pickup and drop-off', () => {
		const kinds = ['home', 'pickup', 'venue', 'dropoff', 'home'] as const;
		expect(passengersByLeg(kinds.map((kind) => ({ kind })))).toEqual([0, 1, 1, 0]);
		const two = ['home', 'pickup', 'pickup', 'venue', 'dropoff', 'dropoff', 'home'] as const;
		expect(passengersByLeg(two.map((kind) => ({ kind })))).toEqual([0, 1, 2, 2, 1, 0]);
	});
});

describe('computeDayAllowance', () => {
	it('pays 4.50 Kč/km alone and 5 Kč/km with a colleague', () => {
		const a = computeDayAllowance({
			date: '2026-10-17',
			mode: 'car',
			legs: [km(10), km(40, 1), km(40, 1), km(10)],
			games: [game()]
		});
		expect(a.km).toEqual({ alone: 20, shared: 80 });
		expect(a.mileage).toBe(20 * 4.5 + 80 * 5);
		expect(a.weekday).toBe(0);
	});

	it('uses 6.30 Kč/km with a colleague in NBL', () => {
		const nbl = game({ areaId: 0, leagueName: 'NBL', competitionName: 'Maxa NBL' });
		const a = computeDayAllowance({
			date: '2026-10-17',
			mode: 'car',
			legs: [km(50, 1)],
			games: [nbl]
		});
		expect(a.mileage).toBe(Math.round(50 * 6.3));
	});

	it('gives the meal allowance from driving + 3 h 30 min per game', () => {
		const short = computeDayAllowance({
			date: '2026-10-17',
			mode: 'car',
			legs: [km(30, 0, 40), km(30, 0, 40)],
			games: [game()]
		});
		expect(short.minutes).toEqual({ driving: 80, games: 210 });
		expect(short.meal).toBe(0);
		const long = computeDayAllowance({
			date: '2026-10-17',
			mode: 'car',
			legs: [km(150, 0, 90), km(150, 0, 90)],
			games: [game({ gameId: 1 }), game({ gameId: 2 })]
		});
		expect(long.meal).toBe(155); // 3 h + 7 h
	});

	it('adds 300 Kč on weekdays for ČBF competitions, not on holidays or at home', () => {
		const wed = computeDayAllowance({
			date: '2026-10-14',
			mode: 'car',
			legs: [km(60)],
			games: [national]
		});
		expect(wed.weekday).toBe(300);
		expect(wed.total).toBe(wed.travel + wed.meal + 300);
		const holiday = computeDayAllowance({
			date: '2026-10-28',
			mode: 'car',
			legs: [km(60)],
			games: [national]
		});
		expect(holiday.weekday).toBe(0);
		expect(holiday.weekdayNote).toMatch(/svátek/);
		const home = computeDayAllowance({
			date: '2026-10-14',
			mode: 'car',
			legs: [km(5)],
			games: [national],
			homeMunicipality: 'Kolín'
		});
		expect(home.weekday).toBe(0);
		const prague = computeDayAllowance({
			date: '2026-10-14',
			mode: 'car',
			legs: [km(5)],
			games: [game()]
		});
		expect(prague.weekday).toBe(0);
	});

	it('pays no mileage to a passenger but counts the trip time', () => {
		const a = computeDayAllowance({
			date: '2026-10-17',
			mode: 'passenger',
			legs: [km(200, 1, 120), km(200, 1, 120)],
			games: [game()]
		});
		expect(a.mileage).toBe(0);
		expect(a.meal).toBe(155);
	});

	it('adds tickets for public transport and receipts in every mode', () => {
		const a = computeDayAllowance({
			date: '2026-10-17',
			mode: 'public',
			legs: [km(100, 0, 90), km(100, 0, 90)],
			games: [game()],
			ticketCost: 240,
			extraCost: 40
		});
		expect(a.travel).toBe(280);
	});

	it('flags assumed rates and straight-line legs', () => {
		const old = computeDayAllowance({
			date: '2019-10-12',
			mode: 'car',
			legs: [km(10)],
			games: [game()]
		});
		expect(old.estimated).toBe(true);
		const approx = computeDayAllowance({
			date: '2026-10-17',
			mode: 'car',
			legs: [{ ...km(10), approximate: true }],
			games: [game()]
		});
		expect(approx.estimated).toBe(true);
	});
});

describe('trip stops', () => {
	const venue = (id: number, name: string, lat: number) => ({
		id,
		name,
		street: null,
		city: 'Praha',
		lat,
		lon: 14.4
	});
	const day = (venues: ReturnType<typeof venue>[]): GameDay => ({
		date: '2026-10-17',
		seasonYear: 2026,
		games: venues.map((v, i) => ({
			...game({ gameId: i + 1 }),
			startsAt: null,
			scheduledTime: null,
			seasonYear: 2026,
			homeTeam: null,
			awayTeam: null,
			venue: v,
			colleagues: []
		}))
	});

	it('merges consecutive games in one hall', () => {
		const stops = venueStops(
			day([venue(1, 'Hala A', 50.1), venue(1, 'Hala A', 50.1), venue(2, 'Hala B', 50.2)])
		);
		expect(stops.map((s) => [s.label, s.gameIds])).toEqual([
			['Hala A, Praha', [1, 2]],
			['Hala B, Praha', [3]]
		]);
	});

	it('goes home → venues → home by default', () => {
		const home = { address: 'Doma 1, Praha', lat: 50, lon: 14, municipality: 'Praha' };
		const stops: TripStop[] = defaultStops(day([venue(1, 'Hala A', 50.1)]), home);
		expect(stops.map((s) => s.kind)).toEqual(['home', 'venue', 'home']);
	});
});

describe('mapy client', () => {
	const fakeFetch = (body: unknown, check?: (url: URL) => void) =>
		(async (input: string | URL | Request) => {
			check?.(new URL(String(input)));
			return new Response(JSON.stringify(body), { status: 200 });
		}) as typeof fetch;

	it('parses geocoding results with the municipality', async () => {
		const maps = mapyProvider(
			'KEY',
			fakeFetch(
				{
					items: [
						{
							name: 'Na Folimance 2',
							location: 'Praha 2, Česko',
							position: { lon: 14.43, lat: 50.07 },
							regionalStructure: [
								{ name: 'Na Folimance 2', type: 'regional.address' },
								{ name: 'Praha', type: 'regional.municipality' }
							]
						}
					]
				},
				(url) => {
					expect(url.pathname).toBe('/v1/geocode');
					expect(url.searchParams.get('apikey')).toBe('KEY');
				}
			)
		);
		expect(await maps.geocode('Na Folimance 2, Praha')).toEqual({
			lat: 50.07,
			lon: 14.43,
			label: 'Na Folimance 2, Praha 2, Česko',
			municipality: 'Praha'
		});
	});

	it('reads route length and duration', async () => {
		const maps = mapyProvider(
			'KEY',
			fakeFetch({ length: 41234.6, duration: 2520 }, (url) => {
				expect(url.searchParams.get('start')).toBe('14.4,50');
				expect(url.searchParams.get('routeType')).toBe('car_fast');
			})
		);
		expect(await maps.route({ lat: 50, lon: 14.4 }, { lat: 50.2, lon: 14.9 })).toEqual({
			meters: 41235,
			seconds: 2520,
			approximate: false
		});
	});

	it('estimates a straight line when the API is not available', () => {
		const r = straightLineRoute({ lat: 50.087, lon: 14.421 }, { lat: 49.195, lon: 16.608 });
		expect(r.approximate).toBe(true);
		expect(r.meters / 1000).toBeGreaterThan(220); // Praha–Brno ~185 km straight, ×1.3
		expect(r.meters / 1000).toBeLessThan(260);
	});
});
