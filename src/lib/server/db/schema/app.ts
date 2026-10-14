/**
 * Application layer (PDR 0001, ADR 0006): users paired with a ČBF official and their sessions.
 */
import { index, integer, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { official } from './cbf';

export const appSchema = pgSchema('app');

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** One user per official the person paired themselves with ("To jsem já"). */
export const appUser = appSchema.table('user', {
	id: serial('id').primaryKey(),
	officialId: integer('official_id')
		.notNull()
		.unique()
		.references(() => official.id),
	createdAt: tstz('created_at').notNull().defaultNow(),
	lastLoginAt: tstz('last_login_at').notNull().defaultNow()
});

/** Server-side sessions; `id` is the SHA-256 of the cookie token, the token itself is never stored. */
export const appSession = appSchema.table(
	'session',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => appUser.id, { onDelete: 'cascade' }),
		createdAt: tstz('created_at').notNull().defaultNow(),
		expiresAt: tstz('expires_at').notNull()
	},
	(t) => [index('session_user_idx').on(t.userId)]
);
