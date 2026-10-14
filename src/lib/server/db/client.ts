import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/** Framework-independent DB factory, shared by SvelteKit and the CBF sync worker. */
export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
	const client = postgres(url, options);
	return { db: drizzle(client, { schema }), client };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
