import { eq, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client';
import { fetchLog, fetchState, rawPayload } from '../../db/schema';
import type { EndpointDef, Params } from '../endpoints';
import type { CbfHttpError, FetchResult } from '../http';
import { excluded, existing } from '../normalize/upsert';
import type { SyncReason, TaskContext } from '../tasks';

export type FetchStateRow = typeof fetchState.$inferSelect;

export async function getFetchState(db: DbOrTx, requestKey: string) {
	const [row] = await db.select().from(fetchState).where(eq(fetchState.requestKey, requestKey));
	return row as FetchStateRow | undefined;
}

export async function loadRawPayload(db: DbOrTx, id: number) {
	const [row] = await db.select().from(rawPayload).where(eq(rawPayload.id, id));
	if (!row) throw new Error(`raw_payload ${id} not found`);
	return row;
}

interface FetchIdentity {
	def: EndpointDef;
	params: Params;
	requestKey: string;
	reason: SyncReason;
}

/** Stores a response (deduplicated by hash), updates fetch_state and logs the request. */
export async function recordFetchSuccess(
	db: Db,
	id: FetchIdentity & {
		result: FetchResult;
		previousHash: string | null;
		nextDueAt: Date | null;
		ctx: TaskContext;
	}
): Promise<{ rawPayloadId: number; changed: boolean }> {
	const { def, params, requestKey, result } = id;
	const fetchedAt = new Date(result.startedAt.getTime() + result.durationMs);
	const changed = id.previousHash !== result.contentHash;

	return db.transaction(async (tx) => {
		const [raw] = await tx
			.insert(rawPayload)
			.values({
				source: def.source,
				endpoint: def.key,
				params,
				requestKey,
				url: result.url,
				httpStatus: result.status,
				contentType: result.contentType,
				contentHash: result.contentHash,
				byteSize: result.byteSize,
				body: result.body,
				firstFetchedAt: fetchedAt,
				lastFetchedAt: fetchedAt
			})
			.onConflictDoUpdate({
				target: [rawPayload.requestKey, rawPayload.contentHash],
				set: {
					lastFetchedAt: excluded(rawPayload, 'lastFetchedAt'),
					httpStatus: excluded(rawPayload, 'httpStatus'),
					fetchCount: sql`${existing(rawPayload, 'fetchCount')} + 1`
				}
			})
			.returning({ id: rawPayload.id });

		const state = {
			context: id.ctx,
			lastFetchedAt: fetchedAt,
			lastHttpStatus: result.status,
			lastHash: result.contentHash,
			lastRawPayloadId: raw.id,
			nextDueAt: id.nextDueAt,
			consecutiveFailures: 0,
			lastError: null,
			updatedAt: fetchedAt
		};
		await tx
			.insert(fetchState)
			.values({
				requestKey,
				source: def.source,
				endpoint: def.key,
				params,
				lastChangedAt: fetchedAt,
				...state
			})
			.onConflictDoUpdate({
				target: fetchState.requestKey,
				set: { ...state, ...(changed ? { lastChangedAt: fetchedAt } : {}) }
			});

		await tx.insert(fetchLog).values({
			requestKey,
			endpoint: def.key,
			url: result.url,
			reason: id.reason,
			startedAt: result.startedAt,
			durationMs: result.durationMs,
			httpStatus: result.status,
			byteSize: result.byteSize,
			outcome: changed ? 'stored_changed' : 'stored_same',
			rawPayloadId: raw.id
		});
		return { rawPayloadId: raw.id, changed };
	});
}

export async function recordFetchFailure(db: Db, id: FetchIdentity & { error: CbfHttpError }) {
	const { def, params, requestKey, error } = id;
	await db.transaction(async (tx) => {
		await tx
			.insert(fetchState)
			.values({
				requestKey,
				source: def.source,
				endpoint: def.key,
				params,
				lastHttpStatus: error.status ?? null,
				consecutiveFailures: 1,
				lastError: `${error.kind}: ${error.message}`
			})
			.onConflictDoUpdate({
				target: fetchState.requestKey,
				set: {
					lastHttpStatus: excluded(fetchState, 'lastHttpStatus'),
					consecutiveFailures: sql`${existing(fetchState, 'consecutiveFailures')} + 1`,
					lastError: excluded(fetchState, 'lastError'),
					updatedAt: sql`now()`
				}
			});
		await tx.insert(fetchLog).values({
			requestKey,
			endpoint: def.key,
			url: error.url,
			reason: id.reason,
			startedAt: error.startedAt,
			durationMs: error.durationMs,
			httpStatus: error.status ?? null,
			outcome: `error_${error.kind}`,
			error: error.message
		});
	});
}

export async function markNormalized(
	tx: DbOrTx,
	requestKey: string,
	rawPayloadId: number,
	version: number,
	nextDueAt: Date | null | undefined
) {
	await tx
		.update(fetchState)
		.set({
			normalizedRawPayloadId: rawPayloadId,
			normalizerVersion: version,
			normalizedAt: new Date(),
			lastNormalizeError: null,
			...(nextDueAt !== undefined ? { nextDueAt } : {})
		})
		.where(eq(fetchState.requestKey, requestKey));
}

export async function recordNormalizeError(db: DbOrTx, requestKey: string, message: string) {
	await db
		.update(fetchState)
		.set({ lastNormalizeError: message, updatedAt: new Date() })
		.where(eq(fetchState.requestKey, requestKey));
}
