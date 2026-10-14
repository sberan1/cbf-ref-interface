/**
 * Read models of the referee app (PDR 0001). Everything is computed from the normalized `cbf`
 * schema; a person is the official the user paired with plus every official record sharing its
 * canonical group ID (ADR 0004).
 */
import {
	and,
	asc,
	count,
	countDistinct,
	desc,
	eq,
	gte,
	inArray,
	lt,
	max,
	min,
	notInArray,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { competition, game, gameOfficial, official, season, venue } from '../db/schema';
import {
	bucketKeyBefore,
	currentBucketKey,
	fillTimeline,
	roleKind,
	type BucketCount,
	type Granularity,
	type RoleKind
} from '../../referee/timeline';
import { foldText } from './text';

export { foldText };

export interface OfficialCandidate {
	id: number;
	groupId: number | null;
	firstName: string | null;
	lastName: string | null;
	games: number;
	refereeGames: number;
	commissionerGames: number;
	lastGameDate: string | null;
}

const DIACRITICS_FROM = 'áäčďéěëíĺľňóôöŕřšťúůüýž';
const DIACRITICS_TO = 'aacdeeeillnooorrstuuuyz';

function foldedName(): SQL {
	return sql`translate(lower(coalesce(${official.firstName}, '') || ' ' || coalesce(${official.lastName}, '')), ${DIACRITICS_FROM}, ${DIACRITICS_TO})`;
}

/** Officials matching a name ("novak jan", diacritics optional) or an ID (v2 or canonical). */
export async function searchOfficials(db: DbOrTx, query: string): Promise<OfficialCandidate[]> {
	const q = query.trim();
	if (q.length < 2) return [];
	const conditions: SQL[] = [];
	if (/^\d+$/.test(q)) {
		const n = Number(q);
		conditions.push(or(eq(official.id, n), eq(official.groupId, n)) as SQL);
	} else {
		for (const term of foldText(q).split(/\s+/).filter(Boolean).slice(0, 4)) {
			conditions.push(sql`${foldedName()} like ${`%${term.replace(/[%_\\]/g, '\\$&')}%`}`);
		}
	}
	const rows = await db
		.select({
			id: official.id,
			groupId: official.groupId,
			firstName: official.firstName,
			lastName: official.lastName,
			games: count(gameOfficial.gameId),
			refereeGames:
				sql<number>`count(*) filter (where ${gameOfficial.role} <> 'commissioner')`.mapWith(Number),
			commissionerGames:
				sql<number>`count(*) filter (where ${gameOfficial.role} = 'commissioner')`.mapWith(Number),
			lastGameDate: max(game.scheduledDate)
		})
		.from(official)
		.leftJoin(gameOfficial, eq(gameOfficial.officialId, official.id))
		.leftJoin(game, eq(game.id, gameOfficial.gameId))
		.where(and(...conditions))
		.groupBy(official.id)
		.orderBy(desc(count(gameOfficial.gameId)), asc(official.lastName))
		.limit(25);
	return rows;
}

export async function officialExists(db: DbOrTx, id: number): Promise<boolean> {
	const [row] = await db.select({ id: official.id }).from(official).where(eq(official.id, id));
	return !!row;
}

/** All official records of the same person (same canonical group ID). */
export async function personOfficialIds(
	db: DbOrTx,
	user: { officialId: number; groupId: number | null }
): Promise<number[]> {
	if (user.groupId === null) return [user.officialId];
	const rows = await db
		.select({ id: official.id })
		.from(official)
		.where(eq(official.groupId, user.groupId));
	return [...new Set([user.officialId, ...rows.map((r) => r.id)])];
}

const isCommissioner = sql`${gameOfficial.role} = 'commissioner'`;

export interface RefereeSummary {
	total: number;
	asReferee: number;
	asCommissioner: number;
	played: number;
	upcoming: number;
	currentSeason: number;
	seasons: number;
	competitions: number;
	firstGame: string | null;
	lastPlayedGame: string | null;
}

export async function refereeSummary(
	db: DbOrTx,
	officialIds: number[],
	opts: { today: string; currentSeasonYear: number }
): Promise<RefereeSummary> {
	const [row] = await db
		.select({
			total: countDistinct(gameOfficial.gameId),
			asReferee:
				sql<number>`count(distinct ${gameOfficial.gameId}) filter (where not (${isCommissioner}))`.mapWith(
					Number
				),
			asCommissioner:
				sql<number>`count(distinct ${gameOfficial.gameId}) filter (where ${isCommissioner})`.mapWith(
					Number
				),
			played:
				sql<number>`count(distinct ${gameOfficial.gameId}) filter (where ${game.scheduledDate} <= ${opts.today})`.mapWith(
					Number
				),
			upcoming:
				sql<number>`count(distinct ${gameOfficial.gameId}) filter (where ${game.scheduledDate} > ${opts.today})`.mapWith(
					Number
				),
			currentSeason:
				sql<number>`count(distinct ${gameOfficial.gameId}) filter (where ${competition.seasonYear} = ${opts.currentSeasonYear})`.mapWith(
					Number
				),
			seasons: countDistinct(competition.seasonYear),
			competitions: countDistinct(game.competitionId),
			firstGame: min(game.scheduledDate),
			lastPlayedGame: sql<
				string | null
			>`max(${game.scheduledDate}) filter (where ${game.scheduledDate} <= ${opts.today})`
		})
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.where(inArray(gameOfficial.officialId, officialIds));
	return row;
}

/** Bucketed game counts for the chart; season = all seasons, month = 24 months, week = 26 weeks. */
export async function gamesTimeline(
	db: DbOrTx,
	officialIds: number[],
	granularity: Granularity,
	opts: { now: Date; currentSeasonYear: number }
) {
	const span = { season: 0, month: 23, week: 25 }[granularity];
	const from =
		granularity === 'season'
			? undefined
			: bucketKeyBefore(granularity, opts.now, opts.currentSeasonYear, span);
	const keyExpr: SQL<string> =
		granularity === 'season'
			? sql<string>`${competition.seasonYear}::text`
			: granularity === 'month'
				? sql<string>`to_char(${game.scheduledDate}, 'YYYY-MM')`
				: sql<string>`to_char(date_trunc('week', ${game.scheduledDate}::timestamp), 'YYYY-MM-DD')`;

	const filters: SQL[] = [inArray(gameOfficial.officialId, officialIds)];
	if (granularity === 'season') filters.push(sql`${competition.seasonYear} is not null`);
	else filters.push(sql`${game.scheduledDate} is not null`);
	if (from) {
		const fromDate = granularity === 'month' ? `${from}-01` : from;
		filters.push(gte(game.scheduledDate, fromDate));
	}

	const rows = await db
		.select({
			key: keyExpr,
			commissioner: sql<boolean>`${isCommissioner}`,
			count: countDistinct(gameOfficial.gameId)
		})
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.where(and(...filters))
		.groupBy(keyExpr, isCommissioner);

	const counts: BucketCount[] = rows.map((r) => ({
		key: r.key,
		role: (r.commissioner ? 'commissioner' : 'referee') satisfies RoleKind,
		count: r.count
	}));
	return fillTimeline(granularity, counts, {
		...opts,
		from,
		to: currentBucketKey(granularity, opts.now, opts.currentSeasonYear)
	});
}

export interface GameRow {
	id: number;
	startsAt: Date | null;
	scheduledDate: string | null;
	scheduledTime: string | null;
	role: RoleKind;
	/** referee1 / referee2 / referee3 / commissioner */
	roleCode: string;
	roleName: string;
	competitionName: string | null;
	seasonYear: number | null;
	homeTeam: string | null;
	awayTeam: string | null;
	homeScore: number | null;
	awayScore: number | null;
	venue: string | null;
	city: string | null;
	colleagues: string | null;
}

const roleNames: Record<string, string> = {
	referee1: '1. rozhodčí',
	referee2: '2. rozhodčí',
	referee3: '3. rozhodčí',
	commissioner: 'komisař'
};

/** Upcoming (`direction = 'next'`) or past (`'previous'`) games of the person. */
export async function personGames(
	db: DbOrTx,
	officialIds: number[],
	opts: { direction: 'next' | 'previous'; today: string; limit: number }
): Promise<GameRow[]> {
	const colleagues = sql<string | null>`(
		select string_agg(coalesce(o2.first_name || ' ', '') || coalesce(o2.last_name, ''), ', ' order by go2.role)
		from ${gameOfficial} go2 join ${official} o2 on o2.id = go2.official_id
		where go2.game_id = ${game.id} and go2.official_id <> ${gameOfficial.officialId}
	)`;
	const dateFilter =
		opts.direction === 'next'
			? gte(game.scheduledDate, opts.today)
			: lt(game.scheduledDate, opts.today);
	const rows = await db
		.select({
			id: game.id,
			startsAt: game.startsAt,
			scheduledDate: game.scheduledDate,
			scheduledTime: game.scheduledTime,
			role: gameOfficial.role,
			competitionName: competition.name,
			seasonYear: competition.seasonYear,
			homeTeam: game.homeTeamName,
			awayTeam: game.awayTeamName,
			homeScore: game.homeScore,
			awayScore: game.awayScore,
			venue: venue.name,
			city: venue.city,
			colleagues
		})
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.leftJoin(venue, eq(venue.id, game.venueId))
		.where(and(inArray(gameOfficial.officialId, officialIds), dateFilter))
		.orderBy(
			opts.direction === 'next' ? asc(game.scheduledDate) : desc(game.scheduledDate),
			opts.direction === 'next' ? asc(game.scheduledTime) : desc(game.scheduledTime)
		)
		.limit(opts.limit);
	return rows.map((r) => ({
		...r,
		role: roleKind(r.role),
		roleCode: r.role,
		roleName: roleNames[r.role] ?? r.role
	}));
}

export interface CompetitionRow {
	competitionId: number | null;
	name: string | null;
	seasonYear: number | null;
	referee: number;
	commissioner: number;
}

/** Games per competition and season, most frequent first. */
export async function competitionBreakdown(
	db: DbOrTx,
	officialIds: number[],
	limit = 10
): Promise<CompetitionRow[]> {
	const total = countDistinct(gameOfficial.gameId);
	return db
		.select({
			competitionId: game.competitionId,
			name: competition.name,
			seasonYear: competition.seasonYear,
			referee:
				sql<number>`count(distinct ${gameOfficial.gameId}) filter (where not (${isCommissioner}))`.mapWith(
					Number
				),
			commissioner:
				sql<number>`count(distinct ${gameOfficial.gameId}) filter (where ${isCommissioner})`.mapWith(
					Number
				)
		})
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.where(inArray(gameOfficial.officialId, officialIds))
		.groupBy(game.competitionId, competition.name, competition.seasonYear)
		.orderBy(desc(total), desc(competition.seasonYear))
		.limit(limit);
}

export interface ColleagueRow {
	officialId: number;
	firstName: string | null;
	lastName: string | null;
	games: number;
}

/** Officials who shared the most games with the person (any role). */
export async function topColleagues(
	db: DbOrTx,
	officialIds: number[],
	limit = 5
): Promise<ColleagueRow[]> {
	const mine = db
		.select({ gameId: gameOfficial.gameId })
		.from(gameOfficial)
		.where(inArray(gameOfficial.officialId, officialIds));
	return db
		.select({
			officialId: official.id,
			firstName: official.firstName,
			lastName: official.lastName,
			games: countDistinct(gameOfficial.gameId)
		})
		.from(gameOfficial)
		.innerJoin(official, eq(official.id, gameOfficial.officialId))
		.where(
			and(inArray(gameOfficial.gameId, mine), notInArray(gameOfficial.officialId, officialIds))
		)
		.groupBy(official.id)
		.orderBy(desc(countDistinct(gameOfficial.gameId)), asc(official.lastName))
		.limit(limit);
}

/** Start year of the season ČBF marks as current, falling back to the August rollover. */
export async function currentSeasonStartYear(db: DbOrTx, now = new Date()): Promise<number> {
	const [row] = await db
		.select({ startYear: season.startYear })
		.from(season)
		.where(eq(season.isCurrent, true))
		.orderBy(desc(season.startYear))
		.limit(1);
	if (row?.startYear) return row.startYear;
	return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const pragueDate = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Prague',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** Today's date in Europe/Prague as YYYY-MM-DD (game dates are stored as local dates). */
export function pragueToday(now = new Date()): string {
	return pragueDate.format(now);
}
