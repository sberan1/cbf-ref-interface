/**
 * Application layer: accounts signed in with Google and paired with a ČBF official after an
 * admin's approval (ADR 0008), their sessions (ADR 0006), and the travel data behind the
 * allowances (PDR 0003).
 */
import {
	boolean,
	date,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgSchema,
	primaryKey,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { official } from './cbf';

export const appSchema = pgSchema('app');

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userRoles = ['user', 'admin'] as const;
export type UserRole = (typeof userRoles)[number];
export const userStatuses = ['pending', 'approved', 'rejected'] as const;
export type UserStatus = (typeof userStatuses)[number];

/**
 * An account. `requested_official_id` is the record the person picked ("To jsem já");
 * `official_id` is set when an admin approves the pairing, one account per official.
 */
export const appUser = appSchema.table(
	'user',
	{
		id: serial('id').primaryKey(),
		email: text('email').notNull().unique(),
		name: text('name'),
		avatarUrl: text('avatar_url'),
		role: text('role').$type<UserRole>().notNull().default('user'),
		status: text('status').$type<UserStatus>().notNull().default('pending'),
		officialId: integer('official_id')
			.unique()
			.references(() => official.id),
		requestedOfficialId: integer('requested_official_id').references(() => official.id),
		requestedAt: tstz('requested_at'),
		reviewedAt: tstz('reviewed_at'),
		reviewedByUserId: integer('reviewed_by_user_id'),
		/** start and end of trips (PDR 0003) */
		homeAddress: text('home_address'),
		homeLat: doublePrecision('home_lat'),
		homeLon: doublePrecision('home_lon'),
		homeMunicipality: text('home_municipality'),
		createdAt: tstz('created_at').notNull().defaultNow(),
		lastLoginAt: tstz('last_login_at').notNull().defaultNow()
	},
	(t) => [index('user_status_idx').on(t.status)]
);

/** OAuth identities of a user (Google `sub`). */
export const appOAuthAccount = appSchema.table(
	'oauth_account',
	{
		provider: text('provider').notNull(),
		providerUserId: text('provider_user_id').notNull(),
		userId: integer('user_id')
			.notNull()
			.references(() => appUser.id, { onDelete: 'cascade' }),
		email: text('email'),
		createdAt: tstz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.provider, t.providerUserId] }),
		index('oauth_account_user_idx').on(t.userId)
	]
);

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

/** Addresses a user reuses in trips, e.g. where a colleague is picked up. */
export const appPlace = appSchema.table(
	'place',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => appUser.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		address: text('address').notNull(),
		lat: doublePrecision('lat').notNull(),
		lon: doublePrecision('lon').notNull(),
		municipality: text('municipality'),
		createdAt: tstz('created_at').notNull().defaultNow(),
		updatedAt: tstz('updated_at').notNull().defaultNow()
	},
	(t) => [unique('place_user_label_uq').on(t.userId, t.label)]
);

/**
 * The trip of one game day: the stops the user drove through (home, pickups, venues, drop-offs)
 * and the routed legs between them. Amounts are computed on read from the current rates.
 * `status`: `auto` = default plan (alone by car from home), `confirmed` = edited by the user.
 */
export const appTrip = appSchema.table(
	'trip',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => appUser.id, { onDelete: 'cascade' }),
		date: date('date', { mode: 'string' }).notNull(),
		status: text('status').$type<'auto' | 'confirmed'>().notNull(),
		mode: text('mode').$type<'car' | 'passenger' | 'public' | 'none'>().notNull(),
		stops: jsonb('stops').notNull(),
		legs: jsonb('legs'),
		/** public transport tickets (mode `public`), Kč */
		ticketCost: integer('ticket_cost'),
		/** parking and other receipts, Kč */
		extraCost: integer('extra_cost'),
		note: text('note'),
		computedAt: tstz('computed_at'),
		updatedAt: tstz('updated_at').notNull().defaultNow()
	},
	(t) => [unique('trip_user_date_uq').on(t.userId, t.date)]
);

/** Geocoding results (Mapy.com), shared by all users. */
export const appGeoCache = appSchema.table('geo_cache', {
	query: text('query').primaryKey(),
	label: text('label'),
	lat: doublePrecision('lat'),
	lon: doublePrecision('lon'),
	municipality: text('municipality'),
	fetchedAt: tstz('fetched_at').notNull().defaultNow()
});

/** Car routes between two points (Mapy.com `car_fast`), shared by all users. */
export const appRouteCache = appSchema.table('route_cache', {
	key: text('key').primaryKey(),
	meters: integer('meters').notNull(),
	seconds: integer('seconds').notNull(),
	/** straight-line estimate when the routing API was unavailable */
	approximate: boolean('approximate').notNull().default(false),
	fetchedAt: tstz('fetched_at').notNull().defaultNow()
});
