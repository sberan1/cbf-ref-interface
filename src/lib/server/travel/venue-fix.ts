/**
 * Hand-corrected hall positions (PDR 0003). A correction is made by an admin, shared by everyone
 * and wins over the GPS from ČBF; every trip through the hall is routed again right away.
 */
import { and, count, desc, eq, isNotNull, isNull, max, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { appTrip, appUser, appVenueFix, game, venue } from '../db/schema';
import { foldSql } from '../referee/queries';
import { foldText } from '../referee/text';
import type { MapProvider, Point } from './mapy';
import { parseStops, resolveStops, routeLegs, TripError } from './trips';

export interface RerouteResult {
	rerouted: number;
	/** trips that could not be routed again (a stop without position); they keep their old route */
	failed: number;
}

/**
 * Trips of every user with a stop at a game played in the venue, routed again with the hall at
 * `point` (null: looked up by its address). Everything else about the trips stays.
 */
async function rerouteTrips(
	db: DbOrTx,
	maps: MapProvider,
	venueId: number,
	point: Point | null
): Promise<RerouteResult> {
	const games = await db.select({ id: game.id }).from(game).where(eq(game.venueId, venueId));
	const ids = new Set(games.map((g) => g.id));
	if (ids.size === 0) return { rerouted: 0, failed: 0 };
	const trips = await db
		.select({ id: appTrip.id, mode: appTrip.mode, stops: appTrip.stops })
		.from(appTrip).where(sql`exists (
			select 1
			from jsonb_array_elements(case when jsonb_typeof(${appTrip.stops}) = 'array' then ${appTrip.stops} else '[]'::jsonb end) s
			cross join jsonb_array_elements_text(case when jsonb_typeof(s->'gameIds') = 'array' then s->'gameIds' else '[]'::jsonb end) gid
			join ${game} g on g.id = gid::int
			where s->>'kind' = 'venue' and g.venue_id = ${venueId}
		)`);
	const result: RerouteResult = { rerouted: 0, failed: 0 };
	for (const t of trips) {
		const stops = parseStops(t.stops).map((s) =>
			s.kind === 'venue' && s.gameIds?.some((id) => ids.has(id))
				? { ...s, lat: point?.lat ?? null, lon: point?.lon ?? null }
				: s
		);
		try {
			const resolved = await resolveStops(maps, stops);
			const legs = t.mode === 'none' ? [] : await routeLegs(maps, resolved);
			await db
				.update(appTrip)
				.set({ stops: resolved, legs, computedAt: new Date(), updatedAt: new Date() })
				.where(eq(appTrip.id, t.id));
			result.rerouted++;
		} catch (err) {
			if (!(err instanceof TripError)) throw err;
			result.failed++;
		}
	}
	return result;
}

export async function setVenueFix(
	db: DbOrTx,
	maps: MapProvider,
	fix: { venueId: number; address: string; lat: number; lon: number; userId: number }
): Promise<RerouteResult> {
	const values = { ...fix, updatedAt: new Date() };
	await db
		.insert(appVenueFix)
		.values(values)
		.onConflictDoUpdate({ target: appVenueFix.venueId, set: values });
	return rerouteTrips(db, maps, fix.venueId, { lat: fix.lat, lon: fix.lon });
}

/** Back to ČBF's GPS, or to the address lookup when ČBF has none. */
export async function clearVenueFix(
	db: DbOrTx,
	maps: MapProvider,
	venueId: number
): Promise<RerouteResult> {
	await db.delete(appVenueFix).where(eq(appVenueFix.venueId, venueId));
	const [v] = await db
		.select({ lat: venue.lat, lon: venue.lon })
		.from(venue)
		.where(eq(venue.id, venueId));
	const point = v && v.lat !== null && v.lon !== null ? { lat: v.lat, lon: v.lon } : null;
	return rerouteTrips(db, maps, venueId, point);
}

export async function venueExists(db: DbOrTx, id: number): Promise<boolean> {
	const [row] = await db.select({ id: venue.id }).from(venue).where(eq(venue.id, id));
	return !!row;
}

export async function venueLabel(db: DbOrTx, id: number): Promise<string> {
	const [row] = await db
		.select({ name: venue.name, city: venue.city })
		.from(venue)
		.where(eq(venue.id, id));
	return [row?.name, row?.city].filter(Boolean).join(', ') || 'hala';
}

export type VenueFilter = 'nogps' | 'fixed' | 'all';

export interface VenueRow {
	id: number;
	name: string | null;
	street: string | null;
	zip: string | null;
	city: string | null;
	/** GPS from ČBF */
	lat: number | null;
	lon: number | null;
	fix: { address: string; lat: number; lon: number; by: string | null; at: Date } | null;
	games: number;
	lastGame: string | null;
}

/** Halls for the admin list: matching `query` (name, street or city, diacritics optional). */
export async function listVenues(
	db: DbOrTx,
	opts: { query?: string; filter: VenueFilter; limit: number }
): Promise<VenueRow[]> {
	const conditions: (SQL | undefined)[] = [];
	if (opts.filter === 'nogps') conditions.push(and(isNull(venue.lat), isNull(appVenueFix.venueId)));
	if (opts.filter === 'fixed') conditions.push(isNotNull(appVenueFix.venueId));
	for (const word of (opts.query ?? '').trim().split(/\s+/).filter(Boolean)) {
		const text = foldSql(
			sql`coalesce(${venue.name}, '') || ' ' || coalesce(${venue.street}, '') || ' ' || coalesce(${venue.city}, '')`
		);
		conditions.push(sql`${text} like ${'%' + foldText(word).replace(/[%_\\]/g, '\\$&') + '%'}`);
	}
	const rows = await db
		.select({
			id: venue.id,
			name: venue.name,
			street: venue.street,
			zip: venue.zip,
			city: venue.city,
			lat: venue.lat,
			lon: venue.lon,
			fixAddress: appVenueFix.address,
			fixLat: appVenueFix.lat,
			fixLon: appVenueFix.lon,
			fixAt: appVenueFix.updatedAt,
			fixBy: sql<string | null>`coalesce(${appUser.name}, ${appUser.email})`,
			games: count(game.id),
			lastGame: max(game.scheduledDate)
		})
		.from(venue)
		.leftJoin(appVenueFix, eq(appVenueFix.venueId, venue.id))
		.leftJoin(appUser, eq(appUser.id, appVenueFix.userId))
		.leftJoin(game, eq(game.venueId, venue.id))
		.where(and(...conditions))
		.groupBy(venue.id, appVenueFix.venueId, appUser.id)
		.orderBy(sql`${max(game.scheduledDate)} desc nulls last`, desc(venue.id))
		.limit(opts.limit);
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		street: r.street,
		zip: r.zip,
		city: r.city,
		lat: r.lat,
		lon: r.lon,
		fix:
			r.fixAddress !== null && r.fixLat !== null && r.fixLon !== null && r.fixAt !== null
				? { address: r.fixAddress, lat: r.fixLat, lon: r.fixLon, by: r.fixBy, at: r.fixAt }
				: null,
		games: r.games,
		lastGame: r.lastGame
	}));
}

/** Link to the point on mapy.com (documented URL, no API key). */
export const mapUrl = (p: { lat: number; lon: number }) =>
	`https://mapy.com/fnc/v1/showmap?mapset=basic&center=${p.lon},${p.lat}&zoom=17&marker=true`;
