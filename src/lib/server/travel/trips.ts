/**
 * Game days and their trips (PDR 0003): which games a person had on a day, the default trip
 * (alone by car from home through the venues and back), routing the legs, and the allowances.
 */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { appTrip, competition, game, gameOfficial, official, phase, venue } from '../db/schema';
import {
	computeDayAllowance,
	passengersByLeg,
	tripStopSchema,
	type DayAllowance,
	type DayGame,
	type TripLeg,
	type TripMode,
	type TripStop
} from './allowances';
import type { MapProvider, Point } from './mapy';

export interface DayGameDetail extends DayGame {
	startsAt: Date | null;
	scheduledTime: string | null;
	seasonYear: number | null;
	homeTeam: string | null;
	awayTeam: string | null;
	venue: {
		id: number | null;
		name: string | null;
		street: string | null;
		city: string | null;
		lat: number | null;
		lon: number | null;
	};
	colleagues: string[];
}

export interface GameDay {
	date: string;
	seasonYear: number | null;
	games: DayGameDetail[];
}

/** Every day with a delegation of the person (any role), oldest first. */
export async function gameDays(
	db: DbOrTx,
	officialIds: number[],
	range: { from?: string; to?: string; dates?: string[] } = {}
): Promise<GameDay[]> {
	const colleagues = sql<string[] | null>`(
		select array_agg(coalesce(o2.first_name || ' ', '') || coalesce(o2.last_name, '') order by go2.role)
		from ${gameOfficial} go2 join ${official} o2 on o2.id = go2.official_id
		where go2.game_id = ${game.id} and go2.official_id <> ${gameOfficial.officialId}
	)`;
	const filters = [
		inArray(gameOfficial.officialId, officialIds),
		sql`${game.scheduledDate} is not null`
	];
	if (range.from) filters.push(gte(game.scheduledDate, range.from));
	if (range.to) filters.push(lte(game.scheduledDate, range.to));
	if (range.dates)
		filters.push(inArray(game.scheduledDate, range.dates.length ? range.dates : ['']));
	const rows = await db
		.select({
			date: game.scheduledDate,
			gameId: game.id,
			role: gameOfficial.role,
			startsAt: game.startsAt,
			scheduledTime: game.scheduledTime,
			round: game.round,
			homeTeam: game.homeTeamName,
			awayTeam: game.awayTeamName,
			seasonYear: competition.seasonYear,
			areaId: competition.areaId,
			isFemale: competition.isFemale,
			leagueName: competition.leagueName,
			competitionName: competition.name,
			categoryName: sql<
				string | null
			>`coalesce(${competition.extra}->>'catname', ${competition.extraV1}->'cat'->>'name')`,
			phaseName: phase.name,
			venueId: venue.id,
			venueName: venue.name,
			venueStreet: venue.street,
			venueCity: venue.city,
			venueLat: venue.lat,
			venueLon: venue.lon,
			colleagues
		})
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.leftJoin(phase, eq(phase.id, game.phaseId))
		.leftJoin(venue, eq(venue.id, game.venueId))
		.where(and(...filters))
		.orderBy(asc(game.scheduledDate), asc(game.startsAt), asc(game.scheduledTime));

	const days = new Map<string, GameDay>();
	for (const r of rows) {
		const date = r.date as string;
		const day = days.get(date) ?? { date, seasonYear: r.seasonYear, games: [] };
		if (day.games.some((g) => g.gameId === r.gameId)) continue;
		day.games.push({
			gameId: r.gameId,
			role: r.role,
			startsAt: r.startsAt,
			scheduledTime: r.scheduledTime,
			seasonYear: r.seasonYear,
			homeTeam: r.homeTeam,
			awayTeam: r.awayTeam,
			areaId: r.areaId,
			isFemale: r.isFemale,
			leagueName: r.leagueName,
			competitionName: r.competitionName,
			categoryName: r.categoryName,
			phaseName: r.phaseName,
			round: r.round,
			venueMunicipality: r.venueCity,
			venue: {
				id: r.venueId,
				name: r.venueName,
				street: r.venueStreet,
				city: r.venueCity,
				lat: r.venueLat,
				lon: r.venueLon
			},
			colleagues: (r.colleagues ?? []).map((c) => c.trim()).filter(Boolean)
		});
		days.set(date, day);
	}
	return [...days.values()];
}

export interface Home extends Point {
	address: string;
	municipality: string | null;
}

const venueLabel = (v: DayGameDetail['venue']) =>
	[v.name, v.city].filter(Boolean).join(', ') || 'hala bez názvu';
const venueAddress = (v: DayGameDetail['venue']) =>
	[v.street, v.city].filter(Boolean).join(', ') || [v.name, v.city].filter(Boolean).join(', ');

/** Venues of the day in game order, consecutive games at the same venue merged. */
export function venueStops(day: GameDay): TripStop[] {
	const stops: TripStop[] = [];
	for (const g of day.games) {
		const last = stops.at(-1);
		const sameVenue =
			last &&
			((g.venue.id !== null && last.label === venueLabel(g.venue)) ||
				(last.lat === g.venue.lat && last.lon === g.venue.lon && g.venue.lat !== null));
		if (sameVenue) {
			last.gameIds = [...(last.gameIds ?? []), g.gameId];
			continue;
		}
		stops.push({
			kind: 'venue',
			label: venueLabel(g.venue),
			address: venueAddress(g.venue),
			lat: g.venue.lat,
			lon: g.venue.lon,
			municipality: g.venue.city,
			gameIds: [g.gameId]
		});
	}
	return stops;
}

export function homeStop(home: Home): TripStop {
	return {
		kind: 'home',
		label: 'Domov',
		address: home.address,
		lat: home.lat,
		lon: home.lon,
		municipality: home.municipality
	};
}

/** Alone by car: home → venues → home. */
export function defaultStops(day: GameDay, home: Home): TripStop[] {
	return [homeStop(home), ...venueStops(day), homeStop(home)];
}

/** Fills missing coordinates (venues without GPS, typed addresses) by geocoding. */
export async function resolveStops(maps: MapProvider, stops: TripStop[]): Promise<TripStop[]> {
	const out: TripStop[] = [];
	for (const s of stops) {
		if (s.lat != null && s.lon != null) {
			out.push(s);
			continue;
		}
		// a typed stop is found by its address only: its label is a colleague's name or a place
		// nickname; a venue without a street may still be found by name and city
		const query = s.kind === 'venue' ? s.address || s.label : s.address;
		const found = query ? await maps.geocode(query) : null;
		out.push(
			found
				? {
						...s,
						lat: found.lat,
						lon: found.lon,
						municipality: s.municipality ?? found.municipality
					}
				: s
		);
	}
	return out;
}

export class TripError extends Error {}

/** Routes every leg; all stops need coordinates. */
export async function routeLegs(maps: MapProvider, stops: TripStop[]): Promise<TripLeg[]> {
	const missing = stops.filter((s) => s.lat == null || s.lon == null);
	if (missing.length) {
		throw new TripError(
			`Nenašel jsem polohu: ${missing.map((s) => s.address || s.label).join('; ')}`
		);
	}
	const passengers = passengersByLeg(stops);
	const legs: TripLeg[] = [];
	for (let i = 0; i < stops.length - 1; i++) {
		const a = stops[i] as TripStop & Point;
		const b = stops[i + 1] as TripStop & Point;
		const r = await maps.route({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
		legs.push({ ...r, passengers: passengers[i] });
	}
	return legs;
}

export interface StoredTrip {
	date: string;
	status: 'auto' | 'confirmed';
	mode: TripMode;
	stops: TripStop[];
	legs: TripLeg[];
	ticketCost: number | null;
	extraCost: number | null;
	note: string | null;
	computedAt: Date | null;
}

/** Stored stops are ours; a schema made stricter later must not make old trips unreadable. */
export function parseStops(raw: unknown): TripStop[] {
	const parsed = tripStopSchema.array().safeParse(raw);
	return parsed.success ? parsed.data : Array.isArray(raw) ? (raw as TripStop[]) : [];
}

export async function loadTrips(db: DbOrTx, userId: number, dates?: string[]) {
	const rows = await db
		.select()
		.from(appTrip)
		.where(
			and(
				eq(appTrip.userId, userId),
				dates ? inArray(appTrip.date, dates.length ? dates : ['1900-01-01']) : undefined
			)
		);
	return new Map<string, StoredTrip>(
		rows.map((r) => [
			r.date,
			{
				date: r.date,
				status: r.status,
				mode: r.mode,
				stops: parseStops(r.stops),
				legs: (r.legs ?? []) as TripLeg[],
				ticketCost: r.ticketCost,
				extraCost: r.extraCost,
				note: r.note,
				computedAt: r.computedAt
			}
		])
	);
}

export async function saveTrip(db: DbOrTx, userId: number, trip: Omit<StoredTrip, 'computedAt'>) {
	const values = {
		userId,
		date: trip.date,
		status: trip.status,
		mode: trip.mode,
		stops: trip.stops,
		legs: trip.legs,
		ticketCost: trip.ticketCost,
		extraCost: trip.extraCost,
		note: trip.note,
		computedAt: new Date(),
		updatedAt: new Date()
	};
	await db
		.insert(appTrip)
		.values(values)
		.onConflictDoUpdate({ target: [appTrip.userId, appTrip.date], set: values });
}

export function dayAllowance(
	day: GameDay,
	trip: StoredTrip | undefined,
	home: Home | null
): DayAllowance | null {
	if (!trip) return null;
	return computeDayAllowance({
		date: day.date,
		mode: trip.mode,
		legs: trip.legs,
		games: day.games,
		ticketCost: trip.ticketCost,
		extraCost: trip.extraCost,
		homeMunicipality: home?.municipality
	});
}

/**
 * Default trips for days without one (alone by car from home), up to `limit` days per call so a
 * request stays short; routes are cached, so repeated venues cost no API calls.
 */
export async function autoFill(
	db: DbOrTx,
	maps: MapProvider,
	userId: number,
	home: Home,
	days: GameDay[],
	limit = 40
): Promise<{ filled: number; failed: string[]; remaining: number }> {
	const existing = await loadTrips(
		db,
		userId,
		days.map((d) => d.date)
	);
	const todo = days.filter((d) => !existing.has(d.date));
	let filled = 0;
	let tried = 0;
	const failed: string[] = [];
	// failing days (no home or venue position) stay unfilled and are cheap to retry from the cache,
	// so they don't count against the limit and can't stall the remaining days
	for (const day of todo) {
		if (filled >= limit) break;
		tried++;
		try {
			const stops = await resolveStops(maps, defaultStops(day, home));
			const legs = await routeLegs(maps, stops);
			await saveTrip(db, userId, {
				date: day.date,
				status: 'auto',
				mode: 'car',
				stops,
				legs,
				ticketCost: null,
				extraCost: null,
				note: null
			});
			filled++;
		} catch (err) {
			if (!(err instanceof TripError)) throw err;
			failed.push(`${day.date}: ${err.message}`);
		}
	}
	return { filled, failed, remaining: todo.length - tried };
}
