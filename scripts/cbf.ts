/**
 * CLI of the ČBF sync. Usage: `npm run cbf -- <command> [options]`, see `npm run cbf -- help`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { and, count, eq, gte, isNotNull, like } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import * as schema from '../src/lib/server/db/schema';
import {
	currentSeasonYear,
	loadConfig,
	parseIntList,
	requireDatabaseUrl,
	type CbfConfig
} from '../src/lib/server/cbf/config';
import { runDiscovery } from '../src/lib/server/cbf/discovery';
import { endpoints, isEndpointKey, normalizeParams } from '../src/lib/server/cbf/endpoints';
import { CbfHttpClient } from '../src/lib/server/cbf/http';
import { dueJobs, markDone, type CronState } from '../src/lib/server/cbf/cron';
import { errorMessage, log } from '../src/lib/server/cbf/log';
import { Broker, type QueueRole } from '../src/lib/server/cbf/queue/broker';
import { RateLimiter } from '../src/lib/server/cbf/rate-limiter';
import {
	bootstrapTasks,
	dailyTasks,
	enqueue,
	windowTasks,
	type CrawlScope
} from '../src/lib/server/cbf/scheduler';
import type { TaskContext } from '../src/lib/server/cbf/tasks';
import { runWorkerForever } from '../src/lib/server/cbf/worker';

const HELP = `ČBF sync CLI

  worker [--role all|fetch|normalize]   run queue consumers (Ctrl+C to stop)
  bootstrap [--from Y] [--to Y] [--areas 0-14] [--genders 0,1] [--force]
                                        enqueue full history (default: current + CBF_BOOTSTRAP_SEASONS previous seasons)
  daily                                 enqueue refresh of the current season structure and games
  window                                enqueue game details in the −3/+14 day window
  scheduler                             long-running: daily at CBF_DAILY_AT (Prague), window every
                                        CBF_WINDOW_EVERY_HOURS (replaces cron in Docker)
  fetch <endpoint> [name=value …] [--recurse] [--force]
                                        enqueue one resource, e.g. fetch v2.game game=273093
  renormalize [--endpoint KEY] [--force]
                                        re-run normalization from stored raw payloads (no HTTP)
  refetch-failed [--endpoint KEY]       re-download resources whose stored payload could not be
                                        parsed (e.g. a ČBF error page), then normalize them again
  requeue-dead [--queue fetch|normalize] [--limit N]
  stats                                 queue depths and DB counts
  discover [--out DIR] [--years 2026,2012] [--probe-areas 1-20]
                                        sample every endpoint to files (no DB / RabbitMQ needed)

Endpoints: ${Object.keys(endpoints).join(', ')}
`;

/** AbortSignal that fires on SIGINT/SIGTERM (docker stop). */
function abortOnSignals(): AbortSignal {
	const controller = new AbortController();
	for (const sig of ['SIGINT', 'SIGTERM'] as const) {
		process.once(sig, () => {
			log.info(`${sig} received, finishing in-flight work`);
			controller.abort();
		});
	}
	return controller.signal;
}

function abortableSleep(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});
}

function loadEnvFile() {
	const file = join(process.cwd(), '.env');
	if (existsSync(file)) process.loadEnvFile(file);
}

async function withBroker<T>(config: CbfConfig, fn: (broker: Broker) => Promise<T>): Promise<T> {
	const broker = await Broker.connect(config.amqpUrl, () => currentSeasonYear(config));
	try {
		return await fn(broker);
	} finally {
		await broker.close();
	}
}

async function withDb<T>(
	config: CbfConfig,
	fn: (db: ReturnType<typeof createDb>['db']) => Promise<T>
): Promise<T> {
	const { db, client } = createDb(requireDatabaseUrl(config), { max: 2 });
	try {
		return await fn(db);
	} finally {
		await client.end({ timeout: 5 });
	}
}

function scopeFrom(config: CbfConfig, values: { areas?: string; genders?: string }): CrawlScope {
	const genders = parseIntList(values.genders ?? '0,1');
	if (genders.some((g) => g !== 0 && g !== 1)) throw new Error('--genders accepts only 0 and 1');
	return {
		areas: values.areas ? parseIntList(values.areas) : config.areas,
		genders: genders as (0 | 1)[]
	};
}

async function main() {
	loadEnvFile();
	const [command, ...rest] = process.argv.slice(2);
	const config = loadConfig();
	const year = currentSeasonYear(config);

	switch (command) {
		case 'worker': {
			const { values } = parseArgs({ args: rest, options: { role: { type: 'string' } } });
			const role = values.role ?? 'all';
			if (!['all', 'fetch', 'normalize'].includes(role)) throw new Error(`Unknown role ${role}`);
			await runWorkerForever(
				config,
				{ fetch: role !== 'normalize', normalize: role !== 'fetch' },
				abortOnSignals()
			);
			return;
		}

		case 'scheduler': {
			const signal = abortOnSignals();
			let state: CronState = { lastDaily: null, lastWindow: null };
			log.info('scheduler started', {
				dailyAt: config.dailyAt,
				windowEveryHours: config.windowEveryMs / 3600_000
			});
			while (!signal.aborted) {
				const now = new Date();
				for (const job of dueJobs(state, now, config)) {
					const seasonYear = currentSeasonYear(config, now);
					try {
						const tasks =
							job === 'daily'
								? dailyTasks(seasonYear, scopeFrom(config, {}))
								: await withDb(config, (db) =>
										windowTasks(db, {
											now,
											currentYear: seasonYear,
											maxAgeSec: config.windowMaxAgeSec
										})
									);
						const n = await withBroker(config, (b) => enqueue(b, tasks));
						state = markDone(state, job, now);
						log.info(`${job} enqueued`, { tasks: n });
					} catch (err) {
						log.error(`${job} failed, retrying next minute`, { err: errorMessage(err) });
					}
				}
				await abortableSleep(60_000, signal);
			}
			return;
		}

		case 'bootstrap': {
			const { values } = parseArgs({
				args: rest,
				options: {
					from: { type: 'string' },
					to: { type: 'string' },
					areas: { type: 'string' },
					genders: { type: 'string' },
					force: { type: 'boolean', default: false }
				}
			});
			const to = values.to ? Number(values.to) : year;
			const from = values.from ? Number(values.from) : to - config.bootstrapSeasons;
			if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
				throw new Error('Invalid --from/--to');
			}
			let tasks = bootstrapTasks(from, to, scopeFrom(config, values));
			if (values.force) tasks = tasks.map((t) => ({ ...t, force: true }));
			const n = await withBroker(config, (b) => enqueue(b, tasks));
			log.info('bootstrap enqueued', { from, to, tasks: n });
			return;
		}

		case 'daily': {
			const n = await withBroker(config, (b) =>
				enqueue(b, dailyTasks(year, scopeFrom(config, {})))
			);
			log.info('daily enqueued', { season: year, tasks: n });
			return;
		}

		case 'window': {
			const tasks = await withDb(config, (db) =>
				windowTasks(db, { now: new Date(), currentYear: year, maxAgeSec: config.windowMaxAgeSec })
			);
			const n = await withBroker(config, (b) => enqueue(b, tasks));
			log.info('window enqueued', { tasks: n });
			return;
		}

		case 'fetch': {
			const { values, positionals } = parseArgs({
				args: rest,
				allowPositionals: true,
				options: {
					recurse: { type: 'boolean', default: false },
					force: { type: 'boolean', default: false }
				}
			});
			const [endpoint, ...pairs] = positionals;
			if (!endpoint || !isEndpointKey(endpoint)) throw new Error(`Unknown endpoint "${endpoint}"`);
			const params = normalizeParams(
				endpoints[endpoint],
				Object.fromEntries(pairs.map((p) => p.split('=', 2) as [string, string]))
			);
			const ctx: TaskContext = {};
			if (params.season) ctx.seasonYear = Number(params.season);
			if (params.s) ctx.seasonYear = Number(params.s);
			if (params.area) ctx.areaId = Number(params.area);
			if (params.female) ctx.female = Number(params.female);
			if (params.competition) ctx.competitionId = Number(params.competition);
			if (params.phase ?? params.p) ctx.phaseId = Number(params.phase ?? params.p);
			await withBroker(config, (b) =>
				b.fetch({
					endpoint,
					params,
					reason: 'manual',
					recurse: values.recurse,
					force: values.force || undefined,
					ctx
				})
			);
			log.info('enqueued', { endpoint, params });
			return;
		}

		case 'renormalize': {
			const { values } = parseArgs({
				args: rest,
				options: { endpoint: { type: 'string' }, force: { type: 'boolean', default: false } }
			});
			if (values.endpoint && !isEndpointKey(values.endpoint)) {
				throw new Error(`Unknown endpoint "${values.endpoint}"`);
			}
			const rows = await withDb(config, (db) =>
				db
					.select({
						endpoint: schema.fetchState.endpoint,
						params: schema.fetchState.params,
						context: schema.fetchState.context
					})
					.from(schema.fetchState)
					.where(
						and(
							isNotNull(schema.fetchState.lastRawPayloadId),
							values.endpoint ? eq(schema.fetchState.endpoint, values.endpoint) : undefined
						)
					)
			);
			await withBroker(config, async (b) => {
				for (const row of rows) {
					if (!isEndpointKey(row.endpoint)) continue;
					await b.normalize({
						endpoint: row.endpoint,
						params: row.params,
						reason: 'manual',
						recurse: false,
						force: values.force || undefined,
						ctx: (row.context ?? {}) as TaskContext
					});
				}
			});
			log.info('renormalize enqueued', { tasks: rows.length });
			return;
		}

		case 'refetch-failed': {
			const { values } = parseArgs({ args: rest, options: { endpoint: { type: 'string' } } });
			if (values.endpoint && !isEndpointKey(values.endpoint)) {
				throw new Error(`Unknown endpoint "${values.endpoint}"`);
			}
			const rows = await withDb(config, (db) =>
				db
					.select({
						endpoint: schema.fetchState.endpoint,
						params: schema.fetchState.params,
						context: schema.fetchState.context
					})
					.from(schema.fetchState)
					.where(
						and(
							like(schema.fetchState.lastNormalizeError, 'parse:%'),
							values.endpoint ? eq(schema.fetchState.endpoint, values.endpoint) : undefined
						)
					)
			);
			await withBroker(config, async (b) => {
				for (const row of rows) {
					if (!isEndpointKey(row.endpoint)) continue;
					await b.fetch({
						endpoint: row.endpoint,
						params: row.params,
						reason: 'manual',
						recurse: false,
						force: true,
						ctx: (row.context ?? {}) as TaskContext
					});
				}
			});
			log.info('refetch enqueued', { tasks: rows.length });
			return;
		}

		case 'requeue-dead': {
			const { values } = parseArgs({
				args: rest,
				options: { queue: { type: 'string', default: 'fetch' }, limit: { type: 'string' } }
			});
			if (values.queue !== 'fetch' && values.queue !== 'normalize') {
				throw new Error('--queue must be fetch or normalize');
			}
			const role = values.queue as QueueRole;
			const moved = await withBroker(config, (b) =>
				b.requeueDead(role, values.limit ? Number(values.limit) : undefined)
			);
			log.info('requeued', { queue: role, moved });
			return;
		}

		case 'stats': {
			const queueStats = await withBroker(config, (b) => b.queueStats());
			console.table(queueStats);
			await withDb(config, async (db) => {
				const tables = {
					raw_payload: schema.rawPayload,
					fetch_state: schema.fetchState,
					season: schema.season,
					competition: schema.competition,
					phase: schema.phase,
					team: schema.team,
					game: schema.game,
					official: schema.official,
					game_official: schema.gameOfficial,
					game_official_history: schema.gameOfficialHistory,
					standing: schema.standing,
					player: schema.player
				};
				const counts: Record<string, number> = {};
				for (const [name, table] of Object.entries(tables)) {
					const [row] = await db.select({ n: count() }).from(table);
					counts[name] = row.n;
				}
				console.table(counts);
				const hourAgo = new Date(Date.now() - 3600_000);
				const recent = await db
					.select({ outcome: schema.fetchLog.outcome, n: count() })
					.from(schema.fetchLog)
					.where(gte(schema.fetchLog.startedAt, hourAgo))
					.groupBy(schema.fetchLog.outcome);
				console.log('requests in the last hour:');
				console.table(recent);
				const perSeason = await db
					.select({ season: schema.competition.seasonYear, competitions: count() })
					.from(schema.competition)
					.groupBy(schema.competition.seasonYear)
					.orderBy(schema.competition.seasonYear);
				console.table(perSeason);
				const failing = await db
					.select({ n: count() })
					.from(schema.fetchState)
					.where(isNotNull(schema.fetchState.lastNormalizeError));
				console.log(`resources with normalization errors: ${failing[0].n}`);
			});
			return;
		}

		case 'discover': {
			const { values } = parseArgs({
				args: rest,
				options: {
					out: { type: 'string' },
					years: { type: 'string' },
					'probe-areas': { type: 'string', default: '1-20' }
				}
			});
			const stamp = new Date().toISOString().replace(/[:.]/g, '-');
			const outDir = values.out ?? join('discovery', 'out', stamp);
			const years = values.years ? parseIntList(values.years).reverse() : [year, year - 14];
			const http = new CbfHttpClient(
				config.http,
				new RateLimiter(config.http.minIntervalMs, config.http.jitterMs)
			);
			const { summaryFile, samples } = await runDiscovery({
				http,
				outDir,
				years,
				probeAreas: parseIntList(values['probe-areas'])
			});
			console.table(
				samples.map((s) => ({
					endpoint: s.endpoint,
					status: s.status,
					bytes: s.bytes,
					format: s.format
				}))
			);
			log.info('discovery done', { summaryFile });
			return;
		}

		case undefined:
		case 'help':
		case '--help':
			console.log(HELP);
			return;

		default:
			console.error(`Unknown command "${command}"\n`);
			console.log(HELP);
			process.exitCode = 1;
	}
}

main().catch((err) => {
	log.error('command failed', {
		err: err instanceof Error ? (err.stack ?? err.message) : String(err)
	});
	process.exitCode = 1;
});
