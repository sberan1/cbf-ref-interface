import { eq, max } from 'drizzle-orm';
import { createDb, type Db } from '../db/client';
import { fetchLog } from '../db/schema';
import { currentSeasonYear, requireDatabaseUrl, type CbfConfig } from './config';
import { CbfHttpClient } from './http';
import { errorMessage, log } from './log';
import { handleFetchTask, type PipelineDeps } from './pipeline/fetch';
import { isRetryable } from './pipeline/errors';
import { handleNormalizeTask } from './pipeline/normalize';
import { Broker, type Consumer, type QueueRole } from './queue/broker';
import { RateLimiter, sleep } from './rate-limiter';
import { fetchTaskSchema, normalizeTaskSchema } from './tasks';

export interface WorkerRoles {
	fetch: boolean;
	normalize: boolean;
}

/** Routes a failed task to a delayed retry or to the dead-letter queue. */
async function settleFailure(
	broker: Broker,
	role: QueueRole,
	task: { attempt: number; endpoint: string; params: Record<string, string> } & Parameters<
		Broker['retry']
	>[1],
	err: unknown,
	maxAttempts: number
) {
	const message = errorMessage(err);
	const attempt = task.attempt + 1;
	// endpoint / params / reason as separate fields, to filter in Graylog (app_endpoint, …)
	const fields = {
		role,
		attempt,
		endpoint: task.endpoint,
		params: task.params,
		reason: task.reason,
		err: message
	};
	if (isRetryable(err) && attempt < maxAttempts) {
		log.warn('task failed, will retry', fields);
		await broker.retry(role, { ...task, attempt }, message);
	} else {
		log.error('task failed permanently', fields);
		await broker.dead(role, { ...task, attempt }, message);
	}
}

/**
 * A block pause (HTTP 403/429/503) must survive worker restarts and single-active-consumer
 * failover to another process, so it is resumed from the request log.
 */
async function resumeBlockPause(db: Db, limiter: RateLimiter, blockPauseMs: number) {
	const [row] = await db
		.select({ last: max(fetchLog.startedAt) })
		.from(fetchLog)
		.where(eq(fetchLog.outcome, 'error_blocked'));
	const remaining = row?.last ? row.last.getTime() + blockPauseMs - Date.now() : 0;
	if (remaining > 0) {
		limiter.pause(remaining);
		log.warn('resuming block pause after HTTP 403/429/503', { remainingMs: remaining });
	}
}

/**
 * Runs consumers until the AMQP connection drops or `signal` aborts. Resolves on abort, rejects on
 * connection loss (the CLI restarts it).
 */
export async function runWorker(
	config: CbfConfig,
	roles: WorkerRoles,
	signal: AbortSignal,
	limiter = new RateLimiter(config.http.minIntervalMs, config.http.jitterMs)
) {
	const { db, client } = createDb(requireDatabaseUrl(config), { max: 5 });
	const currentYear = () => currentSeasonYear(config);
	const http = new CbfHttpClient(config.http, limiter);
	let broker: Broker | undefined;
	const consumers: Consumer[] = [];

	try {
		if (roles.fetch) await resumeBlockPause(db, limiter, config.http.blockPauseMs);
		broker = await Broker.connect(config.amqpUrl, currentYear);
		const b = broker;
		const deps: PipelineDeps = { db, sink: b, log, currentYear };

		if (roles.fetch) {
			consumers.push(
				await b.consume('fetch', 1, async (body) => {
					const parsed = fetchTaskSchema.safeParse(body);
					if (!parsed.success)
						return b.dead('fetch', body, `invalid task: ${parsed.error.message}`);
					try {
						await handleFetchTask({ ...deps, http }, parsed.data);
					} catch (err) {
						await settleFailure(b, 'fetch', parsed.data, err, config.maxAttempts);
					}
				})
			);
		}
		if (roles.normalize) {
			consumers.push(
				await b.consume('normalize', config.normalizePrefetch, async (body) => {
					const parsed = normalizeTaskSchema.safeParse(body);
					if (!parsed.success) {
						return b.dead('normalize', body, `invalid task: ${parsed.error.message}`);
					}
					try {
						await handleNormalizeTask(deps, parsed.data);
					} catch (err) {
						await settleFailure(b, 'normalize', parsed.data, err, config.maxAttempts);
					}
				})
			);
		}
		log.info('worker started', { ...roles, currentSeasonYear: currentYear() });

		const aborted = new Promise<'aborted'>((resolve) => {
			if (signal.aborted) resolve('aborted');
			signal.addEventListener('abort', () => resolve('aborted'), { once: true });
		});
		const outcome = await Promise.race([aborted, b.closed]);
		if (outcome !== 'aborted') {
			throw new Error(`AMQP broker unusable${outcome ? `: ${outcome.message}` : ''}`);
		}
		log.info('worker stopping');
	} finally {
		for (const c of consumers) await c.cancel();
		await broker?.close();
		await client.end({ timeout: 5 });
	}
}

/** Keeps the worker running across AMQP/DB outages until aborted. */
export async function runWorkerForever(config: CbfConfig, roles: WorkerRoles, signal: AbortSignal) {
	// one limiter for the whole process: spacing and block pauses survive reconnects
	const limiter = new RateLimiter(config.http.minIntervalMs, config.http.jitterMs);
	while (!signal.aborted) {
		try {
			await runWorker(config, roles, signal, limiter);
		} catch (err) {
			if (signal.aborted) break;
			log.error('worker crashed, restarting in 5 s', { err: errorMessage(err) });
			await sleep(5000);
		}
	}
}
