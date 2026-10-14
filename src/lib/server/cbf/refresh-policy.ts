import type { EndpointKey } from './endpoints';
import type { ParsedGame } from './parse/types';
import type { TaskContext } from './tasks';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Default refresh interval of current-season resources (ADR 0005). Tunable defaults. */
const currentSeasonTtl: Record<EndpointKey, number> = {
	'v2.seasonList': DAY,
	'v2.divs': 20 * HOUR,
	'v2.phases': 20 * HOUR,
	'v2.games': 20 * HOUR,
	'v2.table': 20 * HOUR,
	'v2.game': DAY,
	'v2.team': 7 * DAY,
	'v2.teamplayers': 3 * DAY,
	'v1.divs': DAY,
	'v1.sched': 20 * HOUR,
	'v1.table': DAY
};

/**
 * When a freshly fetched resource becomes due again. NULL = never (historical seasons are treated
 * as immutable; refetch them with `--force`).
 */
export function defaultNextDueAt(
	endpoint: EndpointKey,
	ctx: TaskContext,
	currentYear: number,
	now: Date
): Date | null {
	if (
		endpoint !== 'v2.seasonList' &&
		ctx.seasonYear !== undefined &&
		ctx.seasonYear < currentYear
	) {
		return null;
	}
	return new Date(now.getTime() + currentSeasonTtl[endpoint]);
}

/** Content-aware refresh of a game detail: frequent around the game, never once it is final. */
export function gameDetailNextDueAt(game: ParsedGame, now: Date): Date | null {
	const t = now.getTime();
	if (!game.startsAt) return new Date(t + 3 * DAY);
	const start = game.startsAt.getTime();
	// a result is final once ČBF confirms it (`checked`); unconfirmed results count as final after
	// two weeks so that lower leagues that never confirm do not get refetched forever
	const hasResult = game.homeScore !== null && game.awayScore !== null;
	const final = hasResult && (game.resultChecked !== false || start < t - 14 * DAY);
	if (start < t - 3 * DAY) return final ? null : new Date(t + 3 * DAY);
	if (start <= t + 14 * DAY) return new Date(t + 6 * HOUR);
	return new Date(t + 7 * DAY);
}
