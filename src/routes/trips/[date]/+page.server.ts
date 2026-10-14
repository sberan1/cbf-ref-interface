import { error, fail } from '@sveltejs/kit';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { requireApproved } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { appPlace, appTrip } from '#lib/server/db/schema/index.ts';
import { personOfficialIds } from '#lib/server/referee/queries.ts';
import { tripModes, tripStopSchema, type TripStop } from '#lib/server/travel/allowances.ts';
import { holidayName } from '#lib/server/travel/holidays.ts';
import { getMaps, homeOf } from '#lib/server/travel/service.ts';
import { personDays } from '#lib/server/travel/summary.ts';
import {
	defaultStops,
	homeStop,
	loadTrips,
	resolveStops,
	routeLegs,
	saveTrip,
	TripError,
	venueStops
} from '#lib/server/travel/trips.ts';
import type { Actions, PageServerLoad } from './$types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function dayOf(locals: App.Locals, date: string) {
	if (!DATE.test(date)) error(404, 'Neplatné datum');
	const user = requireApproved(locals.user);
	const db = getDb();
	const ids = await personOfficialIds(db, user);
	const [row] = await personDays(db, user.id, ids, homeOf(user), { dates: [date] });
	if (!row) error(404, 'V tento den nemáš žádný zápas');
	return { user, db, row };
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const { user, db, row } = await dayOf(locals, params.date);
	const home = homeOf(user);
	const { day, trip, allowance } = row;
	const places = await db
		.select({
			id: appPlace.id,
			label: appPlace.label,
			address: appPlace.address,
			lat: appPlace.lat,
			lon: appPlace.lon,
			municipality: appPlace.municipality
		})
		.from(appPlace)
		.where(eq(appPlace.userId, user.id))
		.orderBy(asc(appPlace.label));
	// recent edited trips with colleagues, to copy their pickups and drop-offs
	const recent = await db
		.select({ date: appTrip.date, stops: appTrip.stops })
		.from(appTrip)
		.where(
			and(eq(appTrip.userId, user.id), eq(appTrip.status, 'confirmed'), ne(appTrip.date, day.date))
		)
		.orderBy(desc(appTrip.date))
		.limit(30);
	const copySources = recent
		.map((r) => ({ date: r.date, stops: tripStopSchema.array().parse(r.stops) }))
		.filter((r) => r.stops.some((s) => s.kind === 'pickup' || s.kind === 'dropoff'))
		.slice(0, 8)
		.map((r) => ({
			date: r.date,
			label: r.stops
				.filter((s) => s.kind === 'pickup' || s.kind === 'dropoff')
				.map((s) => `${s.kind === 'pickup' ? '↑' : '↓'} ${s.colleague || s.label}`)
				.join(', ')
		}));

	const stops = trip?.stops ?? (home ? defaultStops(day, home) : venueStops(day));
	return {
		date: day.date,
		holiday: holidayName(day.date) ?? null,
		games: day.games.map((g) => ({
			id: g.gameId,
			startsAt: g.startsAt,
			scheduledDate: day.date,
			competition: g.competitionName,
			teams: `${g.homeTeam ?? '?'} – ${g.awayTeam ?? '?'}`,
			venue: [g.venue.name, g.venue.street, g.venue.city].filter(Boolean).join(', '),
			role: g.role,
			colleagues: g.colleagues
		})),
		colleagues: [...new Set(day.games.flatMap((g) => g.colleagues))],
		hasHome: home !== null,
		mapsLive: getMaps(db).live,
		trip: trip
			? {
					status: trip.status,
					mode: trip.mode,
					ticketCost: trip.ticketCost,
					extraCost: trip.extraCost,
					note: trip.note,
					legs: trip.legs
				}
			: null,
		stops,
		places,
		copySources,
		allowance
	};
};

const formSchema = z.object({
	mode: z.enum(tripModes),
	stops: z.string().transform((s, ctx) => {
		try {
			return tripStopSchema.array().min(1).max(20).parse(JSON.parse(s));
		} catch {
			ctx.addIssue({ code: 'custom', message: 'Neplatná trasa.' });
			return z.NEVER;
		}
	}),
	ticketCost: z.coerce.number().int().min(0).max(100_000).optional(),
	extraCost: z.coerce.number().int().min(0).max(100_000).optional(),
	note: z.string().max(500).optional(),
	savePlaces: z.string().optional()
});

const emptyToUndefined = (v: FormDataEntryValue | null) => (v === null || v === '' ? undefined : v);

export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		const { user, db, row } = await dayOf(locals, params.date);
		const f = await request.formData();
		const parsed = formSchema.safeParse({
			mode: f.get('mode'),
			stops: f.get('stops'),
			ticketCost: emptyToUndefined(f.get('ticketCost')),
			extraCost: emptyToUndefined(f.get('extraCost')),
			note: emptyToUndefined(f.get('note')),
			savePlaces: emptyToUndefined(f.get('savePlaces'))
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Chyba.' });
		const { mode, ticketCost, extraCost, note } = parsed.data;
		const home = homeOf(user);
		if (mode !== 'none' && !home) {
			return fail(400, { error: 'Nejdřív si v profilu nastav bydliště.' });
		}

		// home and venues always come from the server; the client only adds pickups and drop-offs
		const venues = venueStops(row.day);
		let v = 0;
		const stops: TripStop[] = parsed.data.stops
			.map((s) => {
				if (s.kind === 'home') return home ? homeStop(home) : null;
				if (s.kind === 'venue') return venues[v++] ?? null;
				return { ...s, label: s.label || (s.kind === 'pickup' ? 'Vyzvednutí' : 'Vysazení') };
			})
			.filter((s): s is TripStop => s !== null);
		if (v < venues.length) stops.splice(stops.length - 1, 0, ...venues.slice(v));

		const maps = getMaps(db);
		let resolved: TripStop[];
		let legs;
		try {
			resolved = await resolveStops(maps, stops);
			legs = mode === 'none' ? [] : await routeLegs(maps, resolved);
		} catch (err) {
			if (err instanceof TripError) return fail(400, { error: err.message });
			throw err;
		}

		if (parsed.data.savePlaces) {
			for (const s of resolved) {
				if ((s.kind !== 'pickup' && s.kind !== 'dropoff') || !s.colleague || !s.address) continue;
				if (s.lat == null || s.lon == null) continue;
				const values = {
					userId: user.id,
					label: s.colleague.slice(0, 80),
					address: s.address,
					lat: s.lat,
					lon: s.lon,
					municipality: s.municipality ?? null,
					updatedAt: new Date()
				};
				await db
					.insert(appPlace)
					.values(values)
					.onConflictDoUpdate({ target: [appPlace.userId, appPlace.label], set: values });
			}
		}

		await saveTrip(db, user.id, {
			date: row.day.date,
			status: 'confirmed',
			mode,
			stops: resolved,
			legs,
			ticketCost: ticketCost ?? null,
			extraCost: extraCost ?? null,
			note: note ?? null
		});
		return { saved: true };
	},

	copy: async ({ locals, params, request }) => {
		const { user, db, row } = await dayOf(locals, params.date);
		const home = homeOf(user);
		if (!home) return fail(400, { error: 'Nejdřív si v profilu nastav bydliště.' });
		const source = String((await request.formData()).get('source') ?? '');
		if (!DATE.test(source)) return fail(400, { error: 'Neplatný zdroj.' });
		const src = (await loadTrips(db, user.id, [source])).get(source);
		if (!src) return fail(400, { error: 'Cesta k zkopírování neexistuje.' });
		const firstVenue = src.stops.findIndex((s) => s.kind === 'venue');
		const lastVenue = src.stops.findLastIndex((s) => s.kind === 'venue');
		const before = src.stops.slice(1, firstVenue < 0 ? 1 : firstVenue);
		const after = src.stops.slice(lastVenue < 0 ? -1 : lastVenue + 1, -1);
		const stops = [homeStop(home), ...before, ...venueStops(row.day), ...after, homeStop(home)];
		const maps = getMaps(db);
		try {
			const resolved = await resolveStops(maps, stops);
			await saveTrip(db, user.id, {
				date: row.day.date,
				status: 'confirmed',
				mode: src.mode,
				stops: resolved,
				legs: src.mode === 'none' ? [] : await routeLegs(maps, resolved),
				ticketCost: src.mode === 'public' ? src.ticketCost : null,
				extraCost: null,
				note: null
			});
		} catch (err) {
			if (err instanceof TripError) return fail(400, { error: err.message });
			throw err;
		}
		return { saved: true };
	},

	reset: async ({ locals, params }) => {
		const { user, db, row } = await dayOf(locals, params.date);
		await db
			.delete(appTrip)
			.where(and(eq(appTrip.userId, user.id), eq(appTrip.date, row.day.date)));
		return { reset: true };
	}
};
