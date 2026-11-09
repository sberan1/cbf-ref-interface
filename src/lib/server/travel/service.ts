/** Wiring of the travel features to the app's database and the Mapy.com key. */
import { MAPY_API_KEY } from '$app/env/private';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import type { SessionUser } from '../auth/session';
import { cachedMaps, mapyProvider } from './mapy';
import type { Home } from './trips';

export function getMaps(db: DbOrTx) {
	return cachedMaps(db, MAPY_API_KEY ? mapyProvider(MAPY_API_KEY) : null);
}

export function homeOf(user: SessionUser): Home | null {
	if (!user.homeAddress || user.homeLat === null || user.homeLon === null) return null;
	return {
		address: user.homeAddress,
		lat: user.homeLat,
		lon: user.homeLon,
		municipality: user.homeMunicipality
	};
}

const pointSchema = z.object({
	lat: z.coerce.number().min(-90).max(90),
	lon: z.coerce.number().min(-180).max(180),
	municipality: z.string().max(120).nullish()
});

/** Coordinates picked from a suggestion (form fields lat, lon, municipality), or the geocoded text. */
export async function locate(db: DbOrTx, form: FormData, address: string) {
	const picked = pointSchema.safeParse({
		lat: form.get('lat') || undefined,
		lon: form.get('lon') || undefined,
		municipality: form.get('municipality') || null
	});
	if (picked.success) return picked.data;
	return getMaps(db).geocode(address);
}

export function addressNotFound(db: DbOrTx) {
	return getMaps(db).live
		? 'Adresu se nepodařilo najít, zkus ji upřesnit.'
		: 'Mapy.com nejsou na serveru nastavené (MAPY_API_KEY), adresu nejde vyhledat.';
}
