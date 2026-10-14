/**
 * Geocoding and car routes from the Mapy.com REST API (PDR 0003; the fee overview settles
 * disputes by the fastest route on mapy.cz). Results are cached in `app.geo_cache` and
 * `app.route_cache`; without an API key or when the API fails, routes fall back to a
 * straight-line estimate that is flagged and retried later.
 */
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { appGeoCache, appRouteCache } from '../db/schema';
import { log } from '../log';

export interface Point {
	lat: number;
	lon: number;
}

export interface GeoResult extends Point {
	label: string;
	municipality: string | null;
}

export interface RouteResult {
	meters: number;
	seconds: number;
	approximate: boolean;
}

export interface MapProvider {
	geocode(query: string): Promise<GeoResult | null>;
	suggest(query: string): Promise<GeoResult[]>;
	route(from: Point, to: Point): Promise<RouteResult>;
}

const API = 'https://api.mapy.cz/v1';

interface MapyItem {
	name?: string;
	label?: string;
	location?: string;
	position?: { lon?: number; lat?: number };
	regionalStructure?: { name?: string; type?: string }[];
}

function toGeoResult(item: MapyItem): GeoResult | null {
	const lat = item.position?.lat;
	const lon = item.position?.lon;
	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	const municipality =
		item.regionalStructure?.find((r) => r.type === 'regional.municipality')?.name ?? null;
	const label = [item.name, item.location].filter(Boolean).join(', ') || item.label || '';
	return { lat, lon, label, municipality };
}

export class MapyError extends Error {}

/** Mapy.com client; `fetchFn` is injectable for tests. */
export function mapyProvider(apiKey: string, fetchFn: typeof fetch = fetch): MapProvider {
	async function get(path: string, params: Record<string, string>): Promise<unknown> {
		const url = new URL(`${API}/${path}`);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		url.searchParams.set('lang', 'cs');
		url.searchParams.set('apikey', apiKey);
		const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new MapyError(`Mapy.com ${path}: HTTP ${res.status}`);
		return res.json();
	}
	const items = (body: unknown) =>
		((body as { items?: MapyItem[] }).items ?? [])
			.map(toGeoResult)
			.filter((r): r is GeoResult => r !== null);
	return {
		async geocode(query) {
			return items(await get('geocode', { query, limit: '1' }))[0] ?? null;
		},
		async suggest(query) {
			return items(await get('suggest', { query, limit: '6' }));
		},
		async route(from, to) {
			const body = (await get('routing/route', {
				start: `${from.lon},${from.lat}`,
				end: `${to.lon},${to.lat}`,
				routeType: 'car_fast'
			})) as { length?: number; duration?: number };
			if (typeof body.length !== 'number' || typeof body.duration !== 'number') {
				throw new MapyError('Mapy.com routing: unexpected response');
			}
			return {
				meters: Math.round(body.length),
				seconds: Math.round(body.duration),
				approximate: false
			};
		}
	};
}

/** Haversine distance × 1.3 at 60 km/h: a rough stand-in for a road route. */
export function straightLineRoute(from: Point, to: Point): RouteResult {
	const rad = (d: number) => (d * Math.PI) / 180;
	const dLat = rad(to.lat - from.lat);
	const dLon = rad(to.lon - from.lon);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLon / 2) ** 2;
	const meters = Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(a)) * 1.3);
	return { meters, seconds: Math.round(meters / (60 / 3.6)), approximate: true };
}

const r5 = (n: number) => n.toFixed(5);
export const routeKey = (from: Point, to: Point) =>
	`${r5(from.lat)},${r5(from.lon)}>${r5(to.lat)},${r5(to.lon)}:car_fast`;
const normalizeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

/** Provider backed by the DB caches; `api` is null when no API key is configured. */
export function cachedMaps(db: DbOrTx, api: MapProvider | null): MapProvider & { live: boolean } {
	return {
		live: api !== null,
		async geocode(query) {
			const key = normalizeQuery(query);
			if (!key) return null;
			const [hit] = await db.select().from(appGeoCache).where(eq(appGeoCache.query, key));
			if (hit) {
				return hit.lat === null || hit.lon === null
					? null
					: {
							lat: hit.lat,
							lon: hit.lon,
							label: hit.label ?? query,
							municipality: hit.municipality
						};
			}
			if (!api) return null;
			let found: Awaited<ReturnType<MapProvider['geocode']>>;
			try {
				found = await api.geocode(query);
			} catch (err) {
				// not cached: an outage must not store "not found"
				log.warn('mapy geocode failed', {
					err: err instanceof Error ? err.message : String(err)
				});
				return null;
			}
			await db
				.insert(appGeoCache)
				.values({
					query: key,
					label: found?.label ?? null,
					lat: found?.lat ?? null,
					lon: found?.lon ?? null,
					municipality: found?.municipality ?? null
				})
				.onConflictDoNothing();
			return found;
		},
		async suggest(query) {
			if (!api || normalizeQuery(query).length < 3) return [];
			return api.suggest(query);
		},
		async route(from, to) {
			const key = routeKey(from, to);
			const [hit] = await db.select().from(appRouteCache).where(eq(appRouteCache.key, key));
			if (hit && (!hit.approximate || !api)) {
				return { meters: hit.meters, seconds: hit.seconds, approximate: hit.approximate };
			}
			let result: RouteResult;
			try {
				result = api ? await api.route(from, to) : straightLineRoute(from, to);
			} catch (err) {
				log.warn('mapy route failed, straight-line fallback', {
					err: err instanceof Error ? err.message : String(err)
				});
				result = straightLineRoute(from, to);
			}
			await db
				.insert(appRouteCache)
				.values({ key, ...result, fetchedAt: new Date() })
				.onConflictDoUpdate({
					target: appRouteCache.key,
					set: { ...result, fetchedAt: new Date() }
				});
			return result;
		}
	};
}
