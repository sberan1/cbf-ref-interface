import { endpoints, requestKey } from '../endpoints';
import { errorMessage } from '../log';
import { normalizerFor } from '../normalize';
import type { NormalizeTask } from '../tasks';
import { isRetryable, PermanentError } from './errors';
import { taskParams, type PipelineDeps } from './fetch';
import { getFetchState, loadRawPayload, markNormalized, recordNormalizeError } from './store';

export type NormalizeResult = 'raw-only' | 'missing' | 'written' | 'unchanged';

/**
 * Normalize step: always works with the latest payload of the resource, writes the normalized
 * rows when the payload (or the mapping version) changed and optionally expands child resources.
 */
export async function handleNormalizeTask(
	deps: PipelineDeps,
	task: NormalizeTask
): Promise<NormalizeResult> {
	const normalizer = normalizerFor(task.endpoint);
	if (!normalizer) return 'raw-only';
	const def = endpoints[task.endpoint];
	const key = requestKey(def, taskParams(def, task.params));
	const state = await getFetchState(deps.db, key);
	if (!state?.lastRawPayloadId) {
		deps.log.warn('nothing to normalize', { key });
		return 'missing';
	}
	const needsWrite =
		task.force ||
		state.normalizedRawPayloadId !== state.lastRawPayloadId ||
		state.normalizerVersion !== normalizer.version;
	// A refetch with unchanged content keeps the payload row (and needsWrite false), but the fetch
	// reset next_due_at to the default TTL; the content-aware value has to be computed again.
	const refreshDue =
		normalizer.nextDueAt !== undefined &&
		state.lastFetchedAt !== null &&
		(state.normalizedAt === null || state.lastFetchedAt > state.normalizedAt);
	if (!needsWrite && !refreshDue && !task.recurse) return 'unchanged';

	const raw = await loadRawPayload(deps.db, state.lastRawPayloadId);
	const ok = raw.httpStatus >= 200 && raw.httpStatus < 300;

	let data: unknown = null;
	if (ok) {
		try {
			data = normalizer.parse(raw.body, task);
		} catch (err) {
			await recordNormalizeError(deps.db, key, `parse: ${errorMessage(err)}`);
			throw new PermanentError(`${key}: ${errorMessage(err)}`, { cause: err });
		}
	}

	const now = deps.now?.() ?? new Date();
	const currentYear = deps.currentYear();
	const nextDueAt =
		data === null ? undefined : normalizer.nextDueAt?.(data, { task, now, currentYear });

	if (needsWrite) {
		try {
			await deps.db.transaction(async (tx) => {
				if (data !== null) {
					await normalizer.write(
						{ tx, task, rawPayloadId: raw.id, fetchedAt: raw.lastFetchedAt, now, currentYear },
						data
					);
				}
				await markNormalized(tx, key, raw.id, normalizer.version, nextDueAt);
			});
		} catch (err) {
			if (!isRetryable(err))
				await recordNormalizeError(deps.db, key, `write: ${errorMessage(err)}`);
			throw err;
		}
	} else if (refreshDue) {
		await markNormalized(deps.db, key, raw.id, normalizer.version, nextDueAt);
	}

	if (task.recurse && data !== null && normalizer.children) {
		for (const childTask of normalizer.children(data, task)) await deps.sink.fetch(childTask);
	}
	return needsWrite ? 'written' : 'unchanged';
}
