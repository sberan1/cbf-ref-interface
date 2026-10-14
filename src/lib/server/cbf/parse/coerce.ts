/**
 * Lenient coercion of ČBF values. The export mixes strings and numbers, uses "" / "0" / null for
 * missing values and 0000-00-00 for unscheduled dates.
 */
export type Rec = Record<string, unknown>;

export function isRec(value: unknown): value is Rec {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First present (non-null, non-empty) value of the candidate keys. */
export function pick(rec: Rec, ...keys: string[]): unknown {
	for (const key of keys) {
		const value = rec[key];
		if (value !== undefined && value !== null && value !== '') return value;
	}
	return undefined;
}

export function hasAnyKey(rec: Rec, ...keys: string[]): boolean {
	return keys.some((key) => Object.prototype.hasOwnProperty.call(rec, key));
}

export function str(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value === 'object') {
		// fast-xml-parser represents an element with attributes as { '#text': … }
		if (isRec(value) && '#text' in value) return str(value['#text']);
		return null;
	}
	const s = String(value).trim();
	return s === '' ? null : s;
}

export function int(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
	const s = str(value);
	if (s === null || !/^[-+]?\d+$/.test(s)) return null;
	return Number.parseInt(s, 10);
}

/** ID-like integer: ČBF uses 0 for "nobody", so 0 and negatives become null. */
export function id(value: unknown): number | null {
	const n = int(value);
	return n !== null && n > 0 ? n : null;
}

export function num(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const s = str(value)?.replace(',', '.');
	if (s === undefined || s === null || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
	return Number.parseFloat(s);
}

export function bool01(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value;
	const s = str(value)?.toLowerCase();
	if (s === '1' || s === 'true' || s === 'yes' || s === 'ano') return true;
	if (s === '0' || s === 'false' || s === 'no' || s === 'ne') return false;
	return null;
}

/** YYYY-MM-DD or null (including 0000-00-00 and invalid dates). */
export function cbfDate(value: unknown): string | null {
	const s = str(value);
	const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
	if (!m || m[1] === '0000') return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const date = new Date(Date.UTC(y, mo - 1, d));
	if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
		return null;
	}
	return `${m[1]}-${m[2]}-${m[3]}`;
}

/** HH:MM:SS or null. 00:00:00 is treated as "time not set". */
export function cbfTime(value: unknown): string | null {
	const s = str(value);
	const m = s ? /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s) : null;
	if (!m) return null;
	const [h, mi, se] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
	if (h > 23 || mi > 59 || se > 59) return null;
	if (h === 0 && mi === 0 && se === 0) return null;
	return [h, mi, se].map((n) => String(n).padStart(2, '0')).join(':');
}

const pragueFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: 'Europe/Prague',
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

/** Offset of Europe/Prague from UTC (ms) at the given instant. */
function pragueOffsetMs(instant: number): number {
	const parts = Object.fromEntries(
		pragueFormatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value])
	);
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second)
	);
	return asUtc - instant;
}

/** Converts Europe/Prague wall-clock date + time (ČBF sends them without offset) to a UTC Date. */
export function pragueToUtc(date: string | null, time: string | null): Date | null {
	if (!date || !time) return null;
	const [y, mo, d] = date.split('-').map(Number);
	const [h, mi, se] = time.split(':').map(Number);
	const wall = Date.UTC(y, mo - 1, d, h, mi, se ?? 0);
	let instant = wall - pragueOffsetMs(wall);
	// second pass fixes instants that land on the other side of a DST switch
	instant = wall - pragueOffsetMs(instant);
	return new Date(instant);
}

export interface PeriodScore {
	period: number;
	home: number;
	away: number;
}

export type ScorePair = [number, number];

/** Parses the v2 `score_quarter` string "13:8 32:26 58:48" into score pairs. */
export function parseScoreTokens(value: unknown): ScorePair[] {
	const s = str(value);
	if (!s) return [];
	const pairs: ScorePair[] = [];
	for (const token of s.split(/[\s,;]+/)) {
		const m = /^(\d+)\s*:\s*(\d+)$/.exec(token);
		if (m) pairs.push([Number(m[1]), Number(m[2])]);
	}
	return pairs;
}

/**
 * ČBF publishes the running score after each period ("13:8 32:26 58:48" = after Q1, Q2, Q3; with
 * overtime also after Q4) and the final score separately, in both v2 `score_quarter` and v1
 * `<partials>`. Converts it into points per period; overtimes end up together in period 5.
 * Returns [] when the sequence is not cumulative (inconsistent data).
 */
export function periodsFromCumulative(
	cumulative: ScorePair[],
	final: [number | null, number | null]
): PeriodScore[] {
	const points = [...cumulative];
	const [fh, fa] = final;
	const last = points.at(-1);
	if (fh !== null && fa !== null && (!last || last[0] !== fh || last[1] !== fa)) {
		points.push([fh, fa]);
	}
	const periods: PeriodScore[] = [];
	let prev: ScorePair = [0, 0];
	for (const [h, a] of points) {
		if (h < prev[0] || a < prev[1]) return [];
		periods.push({ period: periods.length + 1, home: h - prev[0], away: a - prev[1] });
		prev = [h, a];
	}
	return periods;
}

/** ČBF sends 0:0 for games that were not played yet. */
export function scorePair(home: unknown, away: unknown): [number | null, number | null] {
	const h = int(home);
	const a = int(away);
	if (h === null || a === null || (h === 0 && a === 0)) return [null, null];
	return [h, a];
}
