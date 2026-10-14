import type { Db } from '../../db/client';
import {
	endpoints,
	normalizeParams,
	requestKey,
	type EndpointDef,
	type Params
} from '../endpoints';
import { CbfHttpError, type CbfHttpClient } from '../http';
import type { Logger } from '../log';
import { normalizerFor } from '../normalize';
import { defaultNextDueAt } from '../refresh-policy';
import type { FetchTask, TaskSink } from '../tasks';
import { PermanentError, RetryableError } from './errors';
import { getFetchState, recordFetchFailure, recordFetchSuccess, type FetchStateRow } from './store';

export interface PipelineDeps {
	db: Db;
	sink: TaskSink;
	log: Logger;
	currentYear: () => number;
	now?: () => Date;
}

export type FetchOutcome = 'skipped' | 'fetched';

/** Invalid parameters are a bug in the producer of the task; retrying cannot help. */
export function taskParams(def: EndpointDef, params: Record<string, string>): Params {
	try {
		return normalizeParams(def, params);
	} catch (err) {
		throw new PermanentError((err as Error).message, { cause: err });
	}
}

export function isFresh(state: FetchStateRow, task: FetchTask, now: Date): boolean {
	if (state.lastRawPayloadId === null || state.lastFetchedAt === null) return false;
	if (task.maxAgeSec !== undefined) {
		return now.getTime() - state.lastFetchedAt.getTime() < task.maxAgeSec * 1000;
	}
	return state.nextDueAt === null || state.nextDueAt.getTime() > now.getTime();
}

/**
 * Fetch step: skip fresh resources (but still let the normalizer expand them), otherwise do one
 * rate-limited request, store the raw payload and hand it over to normalization.
 */
export async function handleFetchTask(
	deps: PipelineDeps & { http: CbfHttpClient },
	task: FetchTask
): Promise<FetchOutcome> {
	const def = endpoints[task.endpoint];
	const params = taskParams(def, task.params);
	const key = requestKey(def, params);
	const now = deps.now?.() ?? new Date();
	const normalizer = normalizerFor(task.endpoint);
	const state = await getFetchState(deps.db, key);
	const followUp = {
		endpoint: task.endpoint,
		params,
		reason: task.reason,
		recurse: task.recurse,
		ctx: task.ctx
	};

	if (!task.force && state && isFresh(state, task, now)) {
		const pending =
			state.normalizedRawPayloadId !== state.lastRawPayloadId ||
			state.normalizerVersion !== normalizer?.version;
		if (normalizer && (task.recurse || pending)) await deps.sink.normalize(followUp);
		deps.log.debug('fetch skipped (fresh)', { key });
		return 'skipped';
	}

	const identity = { def, params, requestKey: key, reason: task.reason };
	let result;
	try {
		result = await deps.http.get(def, params);
	} catch (err) {
		if (!(err instanceof CbfHttpError)) throw err;
		await recordFetchFailure(deps.db, { ...identity, error: err });
		const message = `${key}: ${err.kind} ${err.message}`;
		throw err.retryable
			? new RetryableError(message, { cause: err })
			: new PermanentError(message, { cause: err });
	}

	const { changed } = await recordFetchSuccess(deps.db, {
		...identity,
		result,
		previousHash: state?.lastHash ?? null,
		ctx: task.ctx,
		nextDueAt: defaultNextDueAt(task.endpoint, task.ctx, deps.currentYear(), now)
	});
	deps.log.info('fetched', {
		key,
		status: result.status,
		bytes: result.byteSize,
		ms: result.durationMs,
		changed
	});
	if (normalizer) await deps.sink.normalize({ ...followUp, force: task.force });
	return 'fetched';
}
