/**
 * Applies the SQL migrations in ./drizzle (the same journal drizzle-kit uses), without needing
 * drizzle-kit at runtime. Runs as the one-shot `migrate` service before the app starts (ADR 0007).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../src/lib/server/db/client';

const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

const { db, client } = createDb(url, { max: 1, onnotice: () => undefined });
try {
	await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? 'drizzle' });
	console.log('migrations applied');
} finally {
	await client.end({ timeout: 5 });
}
