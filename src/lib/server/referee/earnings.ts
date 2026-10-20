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
import type { OwnGame } from './own-games';

/** Season start year of a date: seasons start in July. */
export const seasonOfDate = (date: string) =>
	Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0);

export interface FeeRow {
	gameId: number;
	role: string;
	date: string | null;
	seasonYear: number | null;
	competitionId: number | null;
	competitionName: string | null;
	categoryName: string | null;
	homeTeam: string | null;
	awayTeam: string | null;
	played: boolean;
	fee: GameFee;
}

/**
 * Whether a delegation counts as played, still expected, or cancelled. Results often come in the
 * evening or the next day, so a game without one stays expected for a day after the game day.
 */
export function gameStatus(
	date: string | null,
	hasResult: boolean,
	today: string
): 'played' | 'expected' | 'cancelled' {
	if (date === null || date > today) return 'expected';
	if (hasResult) return 'played';
	const graceEnd = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
		.toISOString()
		.slice(0, 10);
	return today > graceEnd ? 'cancelled' : 'expected';
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
			hasResult: sql<boolean>`${game.homeScore} is not null and ${game.awayScore} is not null`,
			homeTeam: game.homeTeamName,
			awayTeam: game.awayTeamName,
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
		const status = gameStatus(r.date, r.hasResult, today);
		const played = status === 'played';
		const fee = gameFee({
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
		});
		return {
			gameId: r.gameId,
			role: r.role,
			date: r.date,
			// derive a season for games whose competition has none
			seasonYear: r.seasonYear ?? (r.date ? seasonOfDate(r.date) : null),
			competitionId: r.competitionId,
			competitionName: r.competitionName,
			categoryName: r.categoryName,
			homeTeam: r.homeTeam,
			awayTeam: r.awayTeam,
			played,
			fee:
				status === 'cancelled' && fee.amount !== null
					? {
							amount: null,
							key: fee.key,
							label: fee.label,
							reason: 'odehraný zápas bez výsledku (zrušený?)'
						}
					: fee
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

/** Fees of games played in a calendar year (for the tax return; seasons span two years). */
export interface YearEarnings {
	year: number;
	paidGames: number;
	earned: number;
	estimated: number;
}

export interface UnratedGroup {
	key: string;
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
	years: YearEarnings[];
	unrated: UnratedGroup[];
	/** games entered by hand (PDR 0004), already part of the totals above */
	own: { games: number; earned: number };
}

/** Rates we only assume (not from an overview nor reported by a referee), or a guessed mapping. */
const isEstimate = (fee: GameFee) => fee.amount !== null && fee.provenance === 'assumed';

export function summarizeEarnings(
	rows: FeeRow[],
	currentSeasonYear: number,
	own: { games: OwnGame[]; today: string } = { games: [], today: '' }
): EarningsSummary {
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
		years: [],
		unrated: [],
		own: { games: 0, earned: 0 }
	};
	const years = new Map<number, YearEarnings>();

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
			const key = `${r.competitionId}:${r.seasonYear}:${r.fee.reason}`;
			const group = unrated.get(key) ?? {
				key,
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
			if (r.date) {
				const y = Number(r.date.slice(0, 4));
				const entry = years.get(y) ?? { year: y, paidGames: 0, earned: 0, estimated: 0 };
				entry.paidGames++;
				entry.earned += amount;
				entry.estimated += estimate;
				years.set(y, entry);
			}
		} else {
			out.upcoming += amount;
			if (season) season.upcoming += amount;
		}
	}

	// own games: the fee as paid (never an estimate), all of it per entry
	for (const g of own.games) {
		const amount = g.fee ?? 0;
		const year = seasonOfDate(g.date);
		const season = seasons.get(year) ?? {
			seasonYear: year,
			paidGames: 0,
			earned: 0,
			estimated: 0,
			upcoming: 0,
			unrated: 0
		};
		seasons.set(year, season);
		if (g.date > own.today) {
			out.upcoming += amount;
			season.upcoming += amount;
			continue;
		}
		out.earned += amount;
		out.paidGames += g.games;
		out.own.games += g.games;
		out.own.earned += amount;
		if (year === currentSeasonYear) out.currentSeason += amount;
		season.earned += amount;
		season.paidGames += g.games;
		const y = Number(g.date.slice(0, 4));
		const entry = years.get(y) ?? { year: y, paidGames: 0, earned: 0, estimated: 0 };
		entry.paidGames += g.games;
		entry.earned += amount;
		years.set(y, entry);
	}

	out.seasons = [...seasons.values()].sort((a, b) => b.seasonYear - a.seasonYear);
	out.years = [...years.values()].sort((a, b) => b.year - a.year);
	out.unrated = [...unrated.values()]
		.sort((a, b) => b.games - a.games || (b.seasonYear ?? 0) - (a.seasonYear ?? 0))
		.slice(0, 12);
	return out;
}

/** Earnings per bucket for the chart, same ranges as the games timeline. */
export function earningsTimeline(
	rows: FeeRow[],
	granularity: Granularity,
	opts: { now: Date; currentSeasonYear: number },
	own: { games: OwnGame[]; today: string } = { games: [], today: '' }
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
		// estimated = played games at assumed rates; upcoming ones are all in expected
		if (!r.played) entry.expected += r.fee.amount;
		else if (isEstimate(r.fee)) entry.estimated += r.fee.amount;
		amounts.set(key, entry);
	}
	for (const g of own.games) {
		if (!g.fee) continue;
		const key = dateBucketKey(granularity, g.date, seasonOfDate(g.date));
		if (from && key < from) continue;
		const entry = amounts.get(key) ?? { amount: 0, estimated: 0, expected: 0 };
		entry.amount += g.fee;
		if (g.date > own.today) entry.expected += g.fee;
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
