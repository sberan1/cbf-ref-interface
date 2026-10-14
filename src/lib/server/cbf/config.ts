import { z } from 'zod';

/** Empty strings (e.g. `CBF_MIN_INTERVAL_MS=`) count as unset, not as 0. */
const emptyAsUnset = (value: unknown) => (value === '' ? undefined : value);

const intFromEnv = (fallback: number) =>
	z.preprocess(emptyAsUnset, z.coerce.number().int().min(0).default(fallback));

const envSchema = z.object({
	DATABASE_URL: z.string().min(1).optional(),
	AMQP_URL: z.string().min(1).default('amqp://guest:guest@localhost:5672'),
	// public clients use both cbf.cz and www.cbf.cz; cbf.cz is the host verified by discovery
	CBF_BASE_URL: z.url().default('https://cbf.cz/xml/'),
	CBF_USER_AGENT: z
		.string()
		.min(1)
		.default('cbf-ref-interface/0.1 (+https://github.com/sberan1/cbf-ref-interface)'),
	/** Minimal pause between two requests to ČBF; a random jitter is added on top (ADR 0005). */
	CBF_MIN_INTERVAL_MS: intFromEnv(2000),
	CBF_JITTER_MS: intFromEnv(1000),
	CBF_REQUEST_TIMEOUT_MS: intFromEnv(30_000),
	/** How long to stop all requests after ČBF answers 403/429/503. */
	CBF_BLOCK_PAUSE_MS: intFromEnv(15 * 60_000),
	CBF_MAX_ATTEMPTS: intFromEnv(6),
	/** Areas to crawl, e.g. "0-14" or "0,1,2". */
	CBF_AREAS: z.string().default('0-14'),
	CBF_BOOTSTRAP_SEASONS: intFromEnv(20),
	/** Override of the current season start year (otherwise derived from the date). */
	CBF_CURRENT_SEASON_YEAR: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1990).optional()),
	/** Max age of a game detail before the window job refetches it. */
	CBF_WINDOW_MAX_AGE_HOURS: intFromEnv(12),
	CBF_NORMALIZE_PREFETCH: intFromEnv(4)
});

export type CbfConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
	const e = envSchema.parse(env);
	return {
		databaseUrl: e.DATABASE_URL,
		amqpUrl: e.AMQP_URL,
		http: {
			baseUrl: e.CBF_BASE_URL.endsWith('/') ? e.CBF_BASE_URL : `${e.CBF_BASE_URL}/`,
			userAgent: e.CBF_USER_AGENT,
			minIntervalMs: e.CBF_MIN_INTERVAL_MS,
			jitterMs: e.CBF_JITTER_MS,
			timeoutMs: e.CBF_REQUEST_TIMEOUT_MS,
			blockPauseMs: e.CBF_BLOCK_PAUSE_MS
		},
		maxAttempts: Math.max(1, e.CBF_MAX_ATTEMPTS),
		areas: parseIntList(e.CBF_AREAS),
		bootstrapSeasons: e.CBF_BOOTSTRAP_SEASONS,
		currentSeasonYear: e.CBF_CURRENT_SEASON_YEAR,
		windowMaxAgeSec: e.CBF_WINDOW_MAX_AGE_HOURS * 3600,
		normalizePrefetch: Math.max(1, e.CBF_NORMALIZE_PREFETCH)
	};
}

export function requireDatabaseUrl(config: CbfConfig): string {
	if (!config.databaseUrl) throw new Error('DATABASE_URL is not set');
	return config.databaseUrl;
}

/** Parses "0-14", "0,3,5-7" into a sorted list of unique integers. */
export function parseIntList(spec: string): number[] {
	const out = new Set<number>();
	for (const part of spec.split(',')) {
		const p = part.trim();
		if (!p) continue;
		const range = /^(\d+)\s*-\s*(\d+)$/.exec(p);
		if (range) {
			const [from, to] = [Number(range[1]), Number(range[2])];
			if (from > to) throw new Error(`Invalid range "${p}"`);
			for (let i = from; i <= to; i++) out.add(i);
		} else if (/^\d+$/.test(p)) {
			out.add(Number(p));
		} else {
			throw new Error(`Invalid integer list item "${p}"`);
		}
	}
	return [...out].sort((a, b) => a - b);
}

/**
 * Start year of the season running at `now`. Czech seasons start in late summer, so
 * August–December belong to the season starting this year.
 */
export function currentSeasonYear(config: Pick<CbfConfig, 'currentSeasonYear'>, now = new Date()) {
	if (config.currentSeasonYear !== undefined) return config.currentSeasonYear;
	const year = now.getUTCFullYear();
	return now.getUTCMonth() >= 7 ? year : year - 1;
}
