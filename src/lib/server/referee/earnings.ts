/**
 * Earnings of a person (PDR 0002): every delegation with its fee from the schedules, and the
 * aggregates the dashboard shows. Computed in TypeScript because the competition → schedule
 * mapping is code; a referee has at most a few thousand games.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { competition, game, gameOfficial, phase } from '../db/schema';
import { gameFee, type GameFee } from '../fees';
import {
	bucketKeyBefore,
	currentBucketKey,
	dateBucketKey,
	fillTimeline,
	type Granularity,
	type TimelineBucket
} from '../../referee/timeline';

export interface FeeRow {
	gameId: number;
	role: string;
	date: string | null;
	seasonYear: number | null;
	competitionId: number | null;
	competitionName: string | null;
	played: boolean;
	fee: GameFee;
}

/** All delegations of the person with the fee of each (commissioners get `amount: null`). */
export async function personFees(
	db: DbOrTx,
	officialIds: number[],
	today: string
): Promise<FeeRow[]> {
	const refereeCount = sql<number>`(
		select count(*) from ${gameOfficial} go2
		where go2.game_id = ${game.id} and go2.role like 'referee%'
	)`.mapWith(Number);
	const rows = await db
		.select({
			gameId: game.id,
			role: gameOfficial.role,
			date: game.scheduledDate,
			round: game.round,
			seasonYear: competition.seasonYear,
			competitionId: competition.id,
			competitionName: competition.name,
			areaId: competition.areaId,
			isFemale: competition.isFemale,
			leagueName: competition.leagueName,
			categoryName: sql<
				string | null
			>`coalesce(${competition.extra}->>'catname', ${competition.extraV1}->'cat'->>'name')`,
			phaseName: phase.name,
			refereeCount
		})
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.leftJoin(phase, eq(phase.id, game.phaseId))
		.where(inArray(gameOfficial.officialId, officialIds));

	return rows.map((r) => {
		const played = r.date !== null && r.date <= today;
		return {
			gameId: r.gameId,
			role: r.role,
			date: r.date,
			seasonYear: r.seasonYear,
			competitionId: r.competitionId,
			competitionName: r.competitionName,
			played,
			fee: gameFee({
				role: r.role,
				date: r.date,
				refereeCount: r.refereeCount,
				played,
				areaId: r.areaId,
				isFemale: r.isFemale,
				categoryName: r.categoryName,
				leagueName: r.leagueName,
				competitionName: r.competitionName,
				phaseName: r.phaseName,
				round: r.round
			})
		};
	});
}

export interface SeasonEarnings {
	seasonYear: number;
	/** refereed games with a fee, played */
	paidGames: number;
	earned: number;
	estimated: number;
	/** expected from upcoming delegations */
	upcoming: number;
	/** refereed games without a known fee */
	unrated: number;
}

export interface UnratedGroup {
	competitionName: string | null;
	seasonYear: number | null;
	reason: string;
	games: number;
}

export interface EarningsSummary {
	earned: number;
	estimated: number;
	currentSeason: number;
	upcoming: number;
	paidGames: number;
	unratedGames: number;
	seasons: SeasonEarnings[];
	unrated: UnratedGroup[];
}

/** Rates we only assume (not from an overview nor reported by a referee), or a guessed mapping. */
const isEstimate = (fee: GameFee) => fee.amount !== null && fee.provenance === 'assumed';

export function summarizeEarnings(rows: FeeRow[], currentSeasonYear: number): EarningsSummary {
	const seasons = new Map<number, SeasonEarnings>();
	const unrated = new Map<string, UnratedGroup>();
	const out: EarningsSummary = {
		earned: 0,
		estimated: 0,
		currentSeason: 0,
		upcoming: 0,
		paidGames: 0,
		unratedGames: 0,
		seasons: [],
		unrated: []
	};

	for (const r of rows) {
		if (r.role === 'commissioner') continue;
		const year = r.seasonYear;
		let season = year === null ? undefined : seasons.get(year);
		if (year !== null && !season) {
			season = { seasonYear: year, paidGames: 0, earned: 0, estimated: 0, upcoming: 0, unrated: 0 };
			seasons.set(year, season);
		}

		if (r.fee.amount === null) {
			out.unratedGames++;
			if (season) season.unrated++;
			const key = `${r.competitionId}:${r.fee.reason}`;
			const group = unrated.get(key) ?? {
				competitionName: r.competitionName,
				seasonYear: r.seasonYear,
				reason: r.fee.reason,
				games: 0
			};
			group.games++;
			unrated.set(key, group);
			continue;
		}

		const amount = r.fee.amount;
		const estimate = isEstimate(r.fee) ? amount : 0;
		if (r.played) {
			out.earned += amount;
			out.estimated += estimate;
			out.paidGames++;
			if (year === currentSeasonYear) out.currentSeason += amount;
			if (season) {
				season.earned += amount;
				season.estimated += estimate;
				season.paidGames++;
			}
		} else {
			out.upcoming += amount;
			if (season) season.upcoming += amount;
		}
	}

	out.seasons = [...seasons.values()].sort((a, b) => b.seasonYear - a.seasonYear);
	out.unrated = [...unrated.values()]
		.sort((a, b) => b.games - a.games || (b.seasonYear ?? 0) - (a.seasonYear ?? 0))
		.slice(0, 12);
	return out;
}

/** Earnings per bucket for the chart, same ranges as the games timeline. */
export function earningsTimeline(
	rows: FeeRow[],
	granularity: Granularity,
	opts: { now: Date; currentSeasonYear: number }
): TimelineBucket[] {
	const span = { season: 0, month: 23, week: 25 }[granularity];
	const from =
		granularity === 'season'
			? undefined
			: bucketKeyBefore(granularity, opts.now, opts.currentSeasonYear, span);

	const amounts = new Map<string, { amount: number; estimated: number; expected: number }>();
	for (const r of rows) {
		if (r.fee.amount === null || r.date === null || r.seasonYear === null) continue;
		const key = dateBucketKey(granularity, r.date, r.seasonYear);
		if (from && key < from) continue;
		const entry = amounts.get(key) ?? { amount: 0, estimated: 0, expected: 0 };
		entry.amount += r.fee.amount;
		if (isEstimate(r.fee)) entry.estimated += r.fee.amount;
		if (!r.played) entry.expected += r.fee.amount;
		amounts.set(key, entry);
	}

	const buckets = fillTimeline(
		granularity,
		[...amounts].map(([key, v]) => ({ key, role: 'referee' as const, count: v.amount })),
		{ ...opts, from, to: currentBucketKey(granularity, opts.now, opts.currentSeasonYear) }
	);
	return buckets.map((b) => ({
		...b,
		estimated: amounts.get(b.key)?.estimated ?? 0,
		expected: amounts.get(b.key)?.expected ?? 0
	}));
}

/** Fee per delegation for the game lists, keyed `${gameId}:${role}`. */
export function feeIndex(rows: FeeRow[]): Map<string, GameFee> {
	return new Map(rows.map((r) => [`${r.gameId}:${r.role}`, r.fee]));
}
