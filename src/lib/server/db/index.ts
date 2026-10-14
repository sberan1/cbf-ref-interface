import { DATABASE_URL } from '$app/env/private';
import { createDb, type Db } from './client';

let instance: ReturnType<typeof createDb> | undefined;

/** The app's database, connected lazily so that building the app needs no database. */
export function getDb(): Db {
	if (!instance) {
		if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
		const created = createDb(DATABASE_URL);
		// adapter-node emits this once the HTTP server has closed; idle pool connections would
		// otherwise keep the process alive until Docker kills it
		process.once('sveltekit:shutdown', () => void created.client.end({ timeout: 5 }));
		instance = created;
	}
	return instance.db;
}
