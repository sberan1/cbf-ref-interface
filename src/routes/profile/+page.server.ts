import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireApproved } from '#lib/server/auth/guards.ts';
import { calendarToken, setCalendarToken } from '#lib/server/calendar/feed.ts';
import { getDb } from '#lib/server/db/index.ts';
import { appPlace, appTrip, appUser } from '#lib/server/db/schema/index.ts';
import { getMaps } from '#lib/server/travel/service.ts';
import type { Actions, PageServerLoad } from './$types';

const pointSchema = z.object({
	lat: z.coerce.number().min(-90).max(90),
	lon: z.coerce.number().min(-180).max(180),
	municipality: z.string().max(120).nullish()
});

/** Coordinates picked from a suggestion, or the geocoded address text. */
async function locate(form: FormData, address: string) {
	const picked = pointSchema.safeParse({
		lat: form.get('lat') || undefined,
		lon: form.get('lon') || undefined,
		municipality: form.get('municipality') || null
	});
	if (picked.success) return picked.data;
	return getMaps(getDb()).geocode(address);
}

const notFound = () =>
	getMaps(getDb()).live
		? 'Adresu se nepodařilo najít, zkus ji upřesnit.'
		: 'Mapy.com nejsou na serveru nastavené (MAPY_API_KEY), adresu nejde vyhledat.';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireApproved(locals.user);
	const [places, token] = await Promise.all([
		getDb()
			.select()
			.from(appPlace)
			.where(eq(appPlace.userId, user.id))
			.orderBy(asc(appPlace.label)),
		calendarToken(getDb(), user.id)
	]);
	return {
		calendarUrl: token ? `${url.origin}/calendar/${token}.ics` : null,
		home: {
			address: user.homeAddress,
			municipality: user.homeMunicipality,
			lat: user.homeLat,
			lon: user.homeLon
		},
		places,
		mapsLive: getMaps(getDb()).live,
		email: user.email
	};
};

export const actions: Actions = {
	/** turns the calendar feed on, or replaces its URL with a new one (PDR 0006) */
	calendarOn: async ({ locals }) => {
		const user = requireApproved(locals.user);
		const renewed = (await calendarToken(getDb(), user.id)) !== null;
		await setCalendarToken(getDb(), user.id, true);
		return { calendarRenewed: renewed };
	},
	calendarOff: async ({ locals }) => {
		const user = requireApproved(locals.user);
		await setCalendarToken(getDb(), user.id, false);
		return { calendarOff: true };
	},
	home: async ({ locals, request }) => {
		const user = requireApproved(locals.user);
		const form = await request.formData();
		const address = String(form.get('address') ?? '').trim();
		if (!address) return fail(400, { homeError: 'Zadej adresu.' });
		if (address.length > 300) return fail(400, { homeError: 'Adresa je moc dlouhá.' });
		const found = await locate(form, address);
		if (!found) return fail(400, { homeError: notFound() });
		await getDb().transaction(async (tx) => {
			await tx
				.update(appUser)
				.set({
					homeAddress: address,
					homeLat: found.lat,
					homeLon: found.lon,
					homeMunicipality: found.municipality ?? null
				})
				.where(eq(appUser.id, user.id));
			// default trips start at the old home: drop them, "Spočítat nevyplněné dny" recomputes them;
			// confirmed ones get the new home when opened and saved in the wizard
			await tx.delete(appTrip).where(and(eq(appTrip.userId, user.id), eq(appTrip.status, 'auto')));
		});
		return { homeSaved: true };
	},
	addPlace: async ({ locals, request }) => {
		const user = requireApproved(locals.user);
		const form = await request.formData();
		const label = String(form.get('label') ?? '')
			.trim()
			.slice(0, 80);
		const address = String(form.get('address') ?? '').trim();
		if (!label || !address) return fail(400, { placeError: 'Vyplň název i adresu.' });
		if (address.length > 300) return fail(400, { placeError: 'Adresa je moc dlouhá.' });
		const found = await locate(form, address);
		if (!found) return fail(400, { placeError: notFound() });
		const values = {
			userId: user.id,
			label,
			address,
			lat: found.lat,
			lon: found.lon,
			municipality: found.municipality ?? null,
			updatedAt: new Date()
		};
		await getDb()
			.insert(appPlace)
			.values(values)
			.onConflictDoUpdate({ target: [appPlace.userId, appPlace.label], set: values });
		return { placeSaved: label };
	},
	deletePlace: async ({ locals, request }) => {
		const user = requireApproved(locals.user);
		const id = Number((await request.formData()).get('id'));
		await getDb()
			.delete(appPlace)
			.where(and(eq(appPlace.id, id), eq(appPlace.userId, user.id)));
		return { placeDeleted: true };
	}
};
