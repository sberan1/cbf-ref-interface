/**
 * Raw layer of the ČBF ingest (ADR 0001, 0004): every HTTP response is kept verbatim,
 * deduplicated by content hash, together with the per-resource fetch state and an audit log.
 */
import {
	bigint,
	bigserial,
	index,
	integer,
	jsonb,
	pgSchema,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';

export const ingestSchema = pgSchema('ingest');

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** One row per distinct response body of one request (request_key + content_hash). */
export const rawPayload = ingestSchema.table(
	'raw_payload',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		source: text('source').notNull(),
		endpoint: text('endpoint').notNull(),
		params: jsonb('params').$type<Record<string, string>>().notNull(),
		requestKey: text('request_key').notNull(),
		url: text('url').notNull(),
		httpStatus: integer('http_status').notNull(),
		contentType: text('content_type'),
		contentHash: text('content_hash').notNull(),
		byteSize: integer('byte_size').notNull(),
		body: text('body').notNull(),
		firstFetchedAt: tstz('first_fetched_at').notNull().defaultNow(),
		lastFetchedAt: tstz('last_fetched_at').notNull().defaultNow(),
		fetchCount: integer('fetch_count').notNull().default(1)
	},
	(t) => [
		uniqueIndex('raw_payload_request_hash_uq').on(t.requestKey, t.contentHash),
		index('raw_payload_endpoint_idx').on(t.endpoint)
	]
);

/** Current state of one remote resource: what we have, when to fetch it again, what is normalized. */
export const fetchState = ingestSchema.table(
	'fetch_state',
	{
		requestKey: text('request_key').primaryKey(),
		source: text('source').notNull(),
		endpoint: text('endpoint').notNull(),
		params: jsonb('params').$type<Record<string, string>>().notNull(),
		/** Task context of the last fetch (season, competition, …), reused by re-normalization. */
		context: jsonb('context').$type<Record<string, number>>(),
		lastFetchedAt: tstz('last_fetched_at'),
		lastHttpStatus: integer('last_http_status'),
		lastHash: text('last_hash'),
		lastRawPayloadId: bigint('last_raw_payload_id', { mode: 'number' }).references(
			() => rawPayload.id
		),
		lastChangedAt: tstz('last_changed_at'),
		/** NULL = never refresh automatically (historical / final data); only `force` refetches. */
		nextDueAt: tstz('next_due_at'),
		consecutiveFailures: integer('consecutive_failures').notNull().default(0),
		lastError: text('last_error'),
		normalizedRawPayloadId: bigint('normalized_raw_payload_id', { mode: 'number' }),
		normalizerVersion: integer('normalizer_version'),
		normalizedAt: tstz('normalized_at'),
		lastNormalizeError: text('last_normalize_error'),
		updatedAt: tstz('updated_at').notNull().defaultNow()
	},
	(t) => [index('fetch_state_endpoint_due_idx').on(t.endpoint, t.nextDueAt)]
);

/** Append-only log of every HTTP request sent to ČBF (audit of how gently we behave). */
export const fetchLog = ingestSchema.table(
	'fetch_log',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		requestKey: text('request_key').notNull(),
		endpoint: text('endpoint').notNull(),
		url: text('url').notNull(),
		reason: text('reason').notNull(),
		startedAt: tstz('started_at').notNull(),
		durationMs: integer('duration_ms').notNull(),
		httpStatus: integer('http_status'),
		byteSize: integer('byte_size'),
		outcome: text('outcome').notNull(),
		error: text('error'),
		rawPayloadId: bigint('raw_payload_id', { mode: 'number' })
	},
	(t) => [
		index('fetch_log_started_at_idx').on(t.startedAt),
		index('fetch_log_request_key_idx').on(t.requestKey)
	]
);
