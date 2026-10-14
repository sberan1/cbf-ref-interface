/** Time buckets of the games chart; shared by the server query and the chart component. */
export const granularities = ['season', 'month', 'week'] as const;
export type Granularity = (typeof granularities)[number];

export const roleKinds = ['referee', 'commissioner'] as const;
export type RoleKind = (typeof roleKinds)[number];

export interface BucketCount {
	/** season: "2026", month: "2026-10", week: ISO date of the Monday ("2026-10-12") */
	key: string;
	role: RoleKind;
	count: number;
}

export interface TimelineBucket {
	key: string;
	label: string;
	referee: number;
	commissioner: number;
	/** bucket lies (at least partly) in the future: delegations, not played games */
	future: boolean;
}

export function isGranularity(value: string | null): value is Granularity {
	return value !== null && (granularities as readonly string[]).includes(value);
}

export function roleKind(role: string): RoleKind {
	return role === 'commissioner' ? 'commissioner' : 'referee';
}

export function seasonLabel(startYear: number): string {
	return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) =>
	`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Monday of the ISO week containing `d` (UTC). */
export function weekStart(d: Date): Date {
	const day = (d.getUTCDay() + 6) % 7;
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

function bucketKey(granularity: Granularity, d: Date, seasonYear: number): string {
	if (granularity === 'season') return String(seasonYear);
	if (granularity === 'month') return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
	return isoDate(weekStart(d));
}

export function bucketLabel(granularity: Granularity, key: string): string {
	if (granularity === 'season') return seasonLabel(Number(key));
	if (granularity === 'month') {
		const [y, m] = key.split('-').map(Number);
		return `${MONTHS[m - 1]} ${y}`;
	}
	const [, m, d] = key.split('-').map(Number);
	return `${d}. ${m}.`;
}

function nextKey(granularity: Granularity, key: string): string {
	if (granularity === 'season') return String(Number(key) + 1);
	if (granularity === 'month') {
		const [y, m] = key.split('-').map(Number);
		return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
	}
	const [y, m, d] = key.split('-').map(Number);
	return isoDate(new Date(Date.UTC(y, m - 1, d + 7)));
}

/**
 * Turns sparse counts into a continuous series from `from` to `to` (inclusive keys, both
 * optional: they default to the first / last bucket with data), so gaps show as empty columns.
 */
export function fillTimeline(
	granularity: Granularity,
	counts: BucketCount[],
	opts: { now: Date; currentSeasonYear: number; from?: string; to?: string }
): TimelineBucket[] {
	const byKey = new Map<string, { referee: number; commissioner: number }>();
	for (const c of counts) {
		const entry = byKey.get(c.key) ?? { referee: 0, commissioner: 0 };
		entry[c.role] += c.count;
		byKey.set(c.key, entry);
	}
	const keys = [...byKey.keys()].sort();
	const from = [opts.from, keys[0]].filter(Boolean).sort()[0];
	const to = [opts.to, keys.at(-1)].filter(Boolean).sort().at(-1);
	if (!from || !to) return [];

	const nowKey = bucketKey(granularity, opts.now, opts.currentSeasonYear);
	const out: TimelineBucket[] = [];
	for (let key = from; key <= to && out.length < 1000; key = nextKey(granularity, key)) {
		const entry = byKey.get(key) ?? { referee: 0, commissioner: 0 };
		out.push({ key, label: bucketLabel(granularity, key), ...entry, future: key > nowKey });
	}
	return out;
}

/** Bucket key for "now", the right edge of the default range. */
export function currentBucketKey(granularity: Granularity, now: Date, currentSeasonYear: number) {
	return bucketKey(granularity, now, currentSeasonYear);
}

/** Bucket key `n` buckets before the current one (left edge of the month / week ranges). */
export function bucketKeyBefore(
	granularity: Granularity,
	now: Date,
	currentSeasonYear: number,
	n: number
): string {
	if (granularity === 'season') return String(currentSeasonYear - n);
	if (granularity === 'month') {
		const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
		return bucketKey('month', d, currentSeasonYear);
	}
	const d = weekStart(now);
	return isoDate(new Date(d.getTime() - n * 7 * 24 * 3600_000));
}
