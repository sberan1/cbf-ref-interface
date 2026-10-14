/** Wiring of the travel features to the app's database and the Mapy.com key. */
import { MAPY_API_KEY } from '$app/env/private';
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
