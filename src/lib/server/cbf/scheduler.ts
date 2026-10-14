/** Builds the root tasks of the sync plans (ADR 0001 §5, ADR 0005). */
import { and, between, eq, isNotNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { competition, game } from '../db/schema';
import type { NewFetchTask, SyncReason, TaskSink } from './tasks';

export interface CrawlScope {
	areas: number[];
	genders: (0 | 1)[];
}

/** Structure of one season: v1 competition list + v2 competitions for every area × gender. */
export function seasonTasks(
	year: number,
	scope: CrawlScope,
	reason: SyncReason,
	force = false
): NewFetchTask[] {
	const extra = force ? { force: true } : {};
	const tasks: NewFetchTask[] = [
		{
			endpoint: 'v1.divs',
			params: { s: String(year) },
			reason,
			recurse: false,
			ctx: { seasonYear: year },
			...extra
		}
	];
	for (const female of scope.genders) {
		for (const area of scope.areas) {
			tasks.push({
				endpoint: 'v2.divs',
				params: { season: String(year), female: String(female), area: String(area) },
				reason,
				recurse: true,
				ctx: { seasonYear: year, areaId: area, female },
				...extra
			});
		}
	}
	return tasks;
}

const seasonListTask = (reason: SyncReason): NewFetchTask => ({
	endpoint: 'v2.seasonList',
	params: {},
	reason,
	recurse: false,
	ctx: {}
});

/** Full history: newest season first (also gets a higher queue priority). */
export function bootstrapTasks(fromYear: number, toYear: number, scope: CrawlScope) {
	const tasks = [seasonListTask('bootstrap')];
	for (let year = toYear; year >= fromYear; year--) {
		tasks.push(...seasonTasks(year, scope, 'bootstrap'));
	}
	return tasks;
}

/** Daily refresh of the current season; freshness checks skip what has not expired yet. */
export function dailyTasks(currentYear: number, scope: CrawlScope) {
	return [seasonListTask('daily'), ...seasonTasks(currentYear, scope, 'daily')];
}

/** Game details in the −3 / +14 day window around now (delegations change there). */
export async function windowTasks(
	db: DbOrTx,
	opts: { now: Date; currentYear: number; maxAgeSec: number }
): Promise<NewFetchTask[]> {
	const day = 24 * 3600_000;
	const rows = await db
		.select({
			id: game.id,
			phaseId: game.phaseId,
			competitionId: game.competitionId,
			seasonYear: competition.seasonYear
		})
		.from(game)
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.where(
			and(
				isNotNull(game.startsAt),
				between(
					game.startsAt,
					new Date(opts.now.getTime() - 3 * day),
					new Date(opts.now.getTime() + 14 * day)
				)
			)
		);
	return rows.map((r) => ({
		endpoint: 'v2.game' as const,
		params: { game: String(r.id) },
		reason: 'window' as const,
		recurse: false,
		maxAgeSec: opts.maxAgeSec,
		ctx: {
			seasonYear: r.seasonYear ?? opts.currentYear,
			...(r.competitionId !== null ? { competitionId: r.competitionId } : {}),
			...(r.phaseId !== null ? { phaseId: r.phaseId } : {})
		}
	}));
}

export async function enqueue(sink: TaskSink, tasks: NewFetchTask[]): Promise<number> {
	for (const task of tasks) await sink.fetch(task);
	return tasks.length;
}
