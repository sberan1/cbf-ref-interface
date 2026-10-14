import type { Tx } from '../../db/client';
import { PermanentError } from '../pipeline/errors';
import type { EndpointKey } from '../endpoints';
import { parseV1Divs, parseV1Sched } from '../parse/v1';
import {
	parseV2Divs,
	parseV2GameDetail,
	parseV2Games,
	parseV2Phases,
	parseV2SeasonList,
	parseV2Table,
	parseV2Team,
	parseV2TeamPlayers
} from '../parse/v2';
import { gameDetailNextDueAt } from '../refresh-policy';
import type { NewFetchTask, NormalizeTask, TaskContext } from '../tasks';
import {
	upsertCompetitionsV1,
	upsertCompetitionsV2,
	upsertPhases,
	upsertSeasons,
	writeGames,
	writeRoster,
	writeStandings,
	writeTeam
} from './writers';

export interface NormalizeContext {
	tx: Tx;
	task: NormalizeTask;
	rawPayloadId: number;
	/** When the payload was (last) fetched – the observation time of its content. */
	fetchedAt: Date;
	now: Date;
	currentYear: number;
}

export interface NormalizeOutcome {
	/** Content-aware override of fetch_state.next_due_at (undefined = keep the default). */
	nextDueAt?: Date | null;
}

interface Normalizer<T> {
	/** Bump when the mapping changes; payloads normalized by an older version get re-normalized. */
	version: number;
	parse(body: string, task: NormalizeTask): T;
	write(ctx: NormalizeContext, data: T): Promise<NormalizeOutcome | void>;
	children?(data: T, task: NormalizeTask): NewFetchTask[];
}

export interface AnyNormalizer {
	version: number;
	parse(body: string, task: NormalizeTask): unknown;
	write(ctx: NormalizeContext, data: unknown): Promise<NormalizeOutcome | void>;
	children?(data: unknown, task: NormalizeTask): NewFetchTask[];
}

const define = <T>(normalizer: Normalizer<T>) => normalizer as unknown as AnyNormalizer;

const numParam = (task: NormalizeTask, name: string): number => {
	const value = Number(task.params[name]);
	if (!Number.isInteger(value)) {
		throw new PermanentError(`${task.endpoint}: parameter ${name} is not an integer`);
	}
	return value;
};

function child(
	parent: NormalizeTask,
	endpoint: EndpointKey,
	params: Record<string, string | number>,
	ctx: Partial<TaskContext>,
	recurse: boolean
): NewFetchTask {
	return {
		endpoint,
		params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
		reason: parent.reason,
		recurse,
		// a forced recursive refresh (e.g. re-downloading a historical season) applies to the subtree
		force: parent.force && parent.recurse ? true : undefined,
		ctx: { ...parent.ctx, ...ctx }
	};
}

const isHistorical = (ctx: NormalizeContext) =>
	ctx.task.ctx.seasonYear !== undefined && ctx.task.ctx.seasonYear < ctx.currentYear;

export const normalizers: Partial<Record<EndpointKey, AnyNormalizer>> = {
	'v2.seasonList': define({
		version: 1,
		parse: (body) => parseV2SeasonList(body),
		write: async ({ tx }, seasons) => upsertSeasons(tx, seasons)
	}),

	'v2.divs': define({
		version: 1,
		parse: (body) => parseV2Divs(body),
		write: async ({ tx, task }, competitions) =>
			upsertCompetitionsV2(tx, competitions, {
				seasonYear: Number(task.params.season),
				areaId: Number(task.params.area),
				female: Number(task.params.female)
			}),
		children: (competitions, task) =>
			competitions.map((c) =>
				child(task, 'v2.phases', { competition: c.id }, { competitionId: c.id }, true)
			)
	}),

	'v2.phases': define({
		version: 1,
		parse: (body) => parseV2Phases(body),
		write: async ({ tx, task }, phases) => upsertPhases(tx, phases, numParam(task, 'competition')),
		children: (phases, task) =>
			phases.flatMap((p) => [
				child(task, 'v2.games', { phase: p.id }, { phaseId: p.id }, true),
				child(task, 'v2.table', { phase: p.id }, { phaseId: p.id }, false),
				child(task, 'v1.sched', { p: p.id }, { phaseId: p.id }, false)
			])
	}),

	'v2.games': define({
		version: 1,
		parse: (body) => parseV2Games(body),
		write: async ({ tx, task, rawPayloadId, fetchedAt }, games) =>
			writeGames(tx, games, {
				source: 'v2.games',
				observedAt: fetchedAt,
				rawPayloadId,
				phaseId: numParam(task, 'phase'),
				competitionId: task.ctx.competitionId
			}),
		children: (games, task) => {
			const teams = new Map<string, { id: number; competition: number }>();
			for (const g of games) {
				const competition = g.competitionId ?? task.ctx.competitionId;
				if (competition === undefined || competition === null) continue;
				for (const teamId of [g.home.id, g.away.id]) {
					if (teamId !== null) teams.set(`${teamId}:${competition}`, { id: teamId, competition });
				}
			}
			return [
				...games.map((g) => child(task, 'v2.game', { game: g.id }, {}, false)),
				...[...teams.values()].flatMap((t) => [
					child(task, 'v2.team', t, { competitionId: t.competition }, false),
					child(task, 'v2.teamplayers', t, { competitionId: t.competition }, false)
				])
			];
		}
	}),

	'v2.game': define({
		version: 1,
		parse: (body) => parseV2GameDetail(body),
		write: async (ctx, { game }) => {
			if (!game) return;
			await writeGames(ctx.tx, [game], {
				source: 'v2.game',
				observedAt: ctx.fetchedAt,
				rawPayloadId: ctx.rawPayloadId,
				competitionId: ctx.task.ctx.competitionId,
				phaseId: ctx.task.ctx.phaseId
			});
			// TODO(discovery): map the statistics part of game.php into player_game_stats.
			return isHistorical(ctx) ? {} : { nextDueAt: gameDetailNextDueAt(game, ctx.now) };
		}
	}),

	'v2.table': define({
		version: 1,
		parse: (body) => parseV2Table(body),
		write: async ({ tx, task }, standings) =>
			writeStandings(tx, numParam(task, 'phase'), standings, task.ctx.competitionId ?? null)
	}),

	'v2.team': define({
		version: 1,
		parse: (body) => parseV2Team(body),
		write: async ({ tx, task }, team) => {
			if (team) await writeTeam(tx, team, numParam(task, 'competition'));
		}
	}),

	'v2.teamplayers': define({
		version: 1,
		parse: (body) => parseV2TeamPlayers(body),
		write: async ({ tx, task }, entries) =>
			writeRoster(tx, numParam(task, 'competition'), numParam(task, 'id'), entries)
	}),

	'v1.divs': define({
		version: 1,
		parse: (body) => parseV1Divs(body),
		write: async ({ tx, task }, competitions) =>
			upsertCompetitionsV1(tx, competitions, Number(task.params.s))
	}),

	'v1.sched': define({
		version: 1,
		parse: (body, task) => parseV1Sched(body, Number(task.params.p)),
		write: async ({ tx, task, rawPayloadId, fetchedAt }, games) =>
			writeGames(tx, games, {
				source: 'v1.sched',
				observedAt: fetchedAt,
				rawPayloadId,
				phaseId: numParam(task, 'p'),
				competitionId: task.ctx.competitionId
			})
	})
	// v1.table: raw only (v2.table is the primary source of standings)
};

export function normalizerFor(endpoint: EndpointKey): AnyNormalizer | undefined {
	return normalizers[endpoint];
}
