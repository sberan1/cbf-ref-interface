import { fail } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { log } from '#lib/server/log.ts';
import { addressNotFound, getMaps, locate } from '#lib/server/travel/service.ts';
import {
	clearVenueFix,
	listVenues,
	mapUrl,
	setVenueFix,
	venueExists,
	venueLabel,
	type VenueFilter
} from '#lib/server/travel/venue-fix.ts';
import type { Actions, PageServerLoad } from './$types';

const LIMIT = 50;
const filters: VenueFilter[] = ['all', 'nogps', 'fixed'];

/** Halls and their positions (PDR 0003): an admin finds a reported hall and corrects it. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals.user);
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const f = url.searchParams.get('f');
	// all halls by default, most recently played first: a reported hall may have wrong GPS too
	const filter: VenueFilter = filters.includes(f as VenueFilter) ? (f as VenueFilter) : 'all';
	const db = getDb();
	const venues = await listVenues(db, { query: q, filter, limit: LIMIT + 1 });
	return {
		q,
		filter,
		more: venues.length > LIMIT,
		mapsLive: getMaps(db).live,
		venues: venues.slice(0, LIMIT).map((v) => {
			const point = v.fix ?? (v.lat !== null && v.lon !== null ? { lat: v.lat, lon: v.lon } : null);
			return {
				...v,
				address: [v.street, [v.zip, v.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
				mapUrl: point ? mapUrl(point) : null
			};
		})
	};
};

/** the hall may leave the filtered list once fixed, so the confirmation names it */
const venueName = (id: number) => venueLabel(getDb(), id);

export const actions: Actions = {
	fix: async ({ locals, request }) => {
		const admin = requireAdmin(locals.user);
		const db = getDb();
		const f = await request.formData();
		const venueId = Number(f.get('venueId'));
		if (!Number.isInteger(venueId) || !(await venueExists(db, venueId))) {
			return fail(400, { venueId, error: 'Neplatná hala.' });
		}
		const address = String(f.get('address') ?? '').trim();
		if (!address) return fail(400, { venueId, error: 'Zadej adresu haly.' });
		if (address.length > 300) return fail(400, { venueId, error: 'Adresa je moc dlouhá.' });
		const found = await locate(db, f, address);
		if (!found) return fail(400, { venueId, error: addressNotFound(db) });
		const r = await setVenueFix(db, getMaps(db), {
			venueId,
			address,
			lat: found.lat,
			lon: found.lon,
			userId: admin.id
		});
		log.info('venue fixed', { userId: admin.id, venueId, ...r });
		return { venueId, venueName: await venueName(venueId), done: 'fixed' as const, ...r };
	},

	unfix: async ({ locals, request }) => {
		const admin = requireAdmin(locals.user);
		const db = getDb();
		const venueId = Number((await request.formData()).get('venueId'));
		if (!Number.isInteger(venueId)) return fail(400, { venueId, error: 'Neplatná hala.' });
		const r = await clearVenueFix(db, getMaps(db), venueId);
		log.info('venue fix removed', { userId: admin.id, venueId, ...r });
		return { venueId, venueName: await venueName(venueId), done: 'reverted' as const, ...r };
	}
};
