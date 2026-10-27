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
import {
	area,
	category,
	competition,
	game,
	gameOfficial,
	official,
	season,
	team,
	venue
} from '../db/schema';
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

/** Age / gender category of a competition (U15 žákyně, muži, …), from the catalogue or the payload. */
const categoryName = sql<
	string | null
>`coalesce(${category.name}, ${competition.extra}->>'catname', ${competition.extraV1}->'cat'->>'name')`;

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
	/** age / gender category of the competition (muži, U15 žákyně, …) */
	category: string | null;
	seasonYear: number | null;
	homeTeam: string | null;
	awayTeam: string | null;
	homeScore: number | null;
	awayScore: number | null;
	venue: string | null;
	city: string | null;
	colleagues: string | null;
}

export const roleNames: Record<string, string> = {
	referee1: '1. rozhodčí',
	referee2: '2. rozhodčí',
	referee3: '3. rozhodčí',
	commissioner: 'komisař'
};

/** Upcoming (`direction = 'next'`) or past (`'previous'`) games of the person. */
export interface GamesFilter {
	/** games shared with any of these officials (a colleague's records) */
	withOfficialIds?: number[];
	/** a team's games, see teamCondition */
	team?: SQL;
	seasonYear?: number;
	areaId?: number;
}

export async function personGames(
	db: DbOrTx,
	officialIds: number[],
	opts: {
		direction: 'next' | 'previous' | 'all';
		today: string;
		limit: number;
		filter?: GamesFilter;
	}
): Promise<GameRow[]> {
	const colleagues = sql<string | null>`(
		select string_agg(coalesce(o2.first_name || ' ', '') || coalesce(o2.last_name, ''), ', ' order by go2.role)
		from ${gameOfficial} go2 join ${official} o2 on o2.id = go2.official_id
		where go2.game_id = ${game.id} and go2.official_id <> ${gameOfficial.officialId}
	)`;
	const dateFilter =
		opts.direction === 'all'
			? undefined
			: opts.direction === 'next'
				? gte(game.scheduledDate, opts.today)
				: lt(game.scheduledDate, opts.today);
	const f = opts.filter ?? {};
	const shared = f.withOfficialIds?.length
		? inArray(
				game.id,
				db
					.select({ id: gameOfficial.gameId })
					.from(gameOfficial)
					.where(inArray(gameOfficial.officialId, f.withOfficialIds))
			)
		: undefined;
	const rows = await db
		.select({
			id: game.id,
			startsAt: game.startsAt,
			scheduledDate: game.scheduledDate,
			scheduledTime: game.scheduledTime,
			role: gameOfficial.role,
			competitionName: competition.name,
			category: categoryName,
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
		.leftJoin(category, eq(category.id, competition.categoryId))
		.leftJoin(venue, eq(venue.id, game.venueId))
		.where(
			and(
				inArray(gameOfficial.officialId, officialIds),
				dateFilter,
				shared,
				f.team,
				f.seasonYear !== undefined ? eq(competition.seasonYear, f.seasonYear) : undefined,
				f.areaId !== undefined ? eq(competition.areaId, f.areaId) : undefined
			)
		)
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
	category: string | null;
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
			category: sql<string | null>`min(${categoryName})`,
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
		.leftJoin(category, eq(category.id, competition.categoryId))
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

export interface ColleagueFilter {
	/** season start year; all seasons when undefined */
	seasonYear?: number;
	/** competition area (0 = celostátní); all areas when undefined */
	areaId?: number;
}

/**
 * Officials who shared the most games with the person (any role), optionally in one season / area;
 * one row per colleague (official records of the same person merged), all of them without `limit`.
 */
export async function topColleagues(
	db: DbOrTx,
	officialIds: number[],
	limit?: number,
	filter: ColleagueFilter = {}
): Promise<ColleagueRow[]> {
	const mine = db
		.select({ gameId: gameOfficial.gameId })
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.where(
			and(
				inArray(gameOfficial.officialId, officialIds),
				filter.seasonYear !== undefined ? eq(competition.seasonYear, filter.seasonYear) : undefined,
				filter.areaId !== undefined ? eq(competition.areaId, filter.areaId) : undefined
			)
		);
	const person = sql`coalesce(${official.groupId}, ${official.id})`;
	const query = db
		.select({
			officialId: sql<number>`min(${official.id})`.mapWith(Number),
			firstName: sql<string | null>`max(${official.firstName})`,
			lastName: sql<string | null>`max(${official.lastName})`,
			games: countDistinct(gameOfficial.gameId)
		})
		.from(gameOfficial)
		.innerJoin(official, eq(official.id, gameOfficial.officialId))
		.where(
			and(inArray(gameOfficial.gameId, mine), notInArray(gameOfficial.officialId, officialIds))
		)
		.groupBy(person)
		.orderBy(desc(countDistinct(gameOfficial.gameId)), sql`max(${official.lastName})`);
	return limit === undefined ? query : query.limit(limit);
}

export interface TeamRow {
	/** `g<lineage>`, `t<team id>` or `n<category>\u001f<name>`: what /games?tym= filters by */
	key: string;
	name: string;
	/** age / gender category of the team's latest competition */
	category: string | null;
	games: number;
	home: number;
	away: number;
	firstSeason: number | null;
	lastSeason: number | null;
}

/** Separates category and name in the key of a team without a record. */
const KEY_SEP = '\u001f';

/**
 * Teams in the person's games, most frequent first, optionally in one season / area. A team is
 * followed across seasons by its lineage (`team.group_id`) and named by its latest name and
 * category; teams without a record are told apart by name and category.
 */
export async function teamBreakdown(
	db: DbOrTx,
	officialIds: number[],
	filter: ColleagueFilter = {}
): Promise<TeamRow[]> {
	const rows = await db.execute(sql`
		with mine as (
			select distinct g.id, g.scheduled_date, c.season_year,
				coalesce(cat.name, c.extra->>'catname', c.extra_v1->'cat'->>'name') as category,
				g.home_team_id, g.away_team_id, g.home_team_name, g.away_team_name
			from ${gameOfficial} go
			join ${game} g on g.id = go.game_id
			left join ${competition} c on c.id = g.competition_id
			left join ${category} cat on cat.id = c.category_id
			where go.official_id in ${officialIds}
				${filter.seasonYear !== undefined ? sql`and c.season_year = ${filter.seasonYear}` : sql``}
				${filter.areaId !== undefined ? sql`and c.area_id = ${filter.areaId}` : sql``}
		), sides as (
			select id, scheduled_date, season_year, category, true as home, home_team_id as team_id, home_team_name as name from mine
			union all
			select id, scheduled_date, season_year, category, false, away_team_id, away_team_name from mine
		)
		select
			coalesce('g' || t.group_id, 't' || s.team_id, 'n' || coalesce(s.category, '') || ${KEY_SEP} || s.name) as key,
			coalesce((array_agg(coalesce(s.name, t.name) order by s.scheduled_date desc nulls last))[1], 'neznámý tým') as name,
			(array_agg(s.category order by s.scheduled_date desc nulls last) filter (where s.category is not null))[1] as category,
			count(distinct s.id)::int as games,
			count(*) filter (where s.home)::int as home,
			count(*) filter (where not s.home)::int as away,
			min(s.season_year) as first_season,
			max(s.season_year) as last_season
		from sides s
		left join ${team} t on t.id = s.team_id
		where s.team_id is not null or coalesce(s.name, '') <> ''
		group by 1
		order by games desc, name
	`);
	return (rows as unknown as Record<string, unknown>[]).map((r) => ({
		key: String(r.key),
		name: String(r.name),
		category: r.category === null ? null : String(r.category),
		games: Number(r.games),
		home: Number(r.home),
		away: Number(r.away),
		firstSeason: r.first_season === null ? null : Number(r.first_season),
		lastSeason: r.last_season === null ? null : Number(r.last_season)
	}));
}

/** SQL condition: the game is one of the team's (by lineage, team ID or name, see TeamRow.key). */
export function teamCondition(key: string): SQL | null {
	const value = key.slice(1);
	if (key.startsWith('g') && /^\d{1,9}$/.test(value)) {
		return sql`exists (select 1 from ${team} t where t.id in (${game.homeTeamId}, ${game.awayTeamId}) and t.group_id = ${Number(value)})`;
	}
	if (key.startsWith('t') && /^\d{1,9}$/.test(value)) {
		return or(eq(game.homeTeamId, Number(value)), eq(game.awayTeamId, Number(value))) ?? null;
	}
	const sep = value.indexOf(KEY_SEP);
	if (key.startsWith('n') && sep >= 0 && value.length <= 300) {
		const cat = value.slice(0, sep);
		const name = value.slice(sep + 1);
		if (!name) return null;
		return sql`(${game.homeTeamName} = ${name} or ${game.awayTeamName} = ${name}) and coalesce((
			select coalesce(cat.name, c.extra->>'catname', c.extra_v1->'cat'->>'name')
			from ${competition} c left join ${category} cat on cat.id = c.category_id
			where c.id = ${game.competitionId}
		), '') = ${cat}`;
	}
	return null;
}

export interface SeasonAreaOptions {
	seasons: number[];
	areas: { id: number; name: string }[];
}

const areaLabel = (id: number, name: string | null) =>
	name?.trim() || (id === 0 ? 'Celostátní soutěže' : `Oblast ${id}`);

/**
 * Seasons and areas the person has games in, for the colleague and team filters; the areas are
 * those of the selected season (all seasons when none is selected).
 */
export async function seasonAreaOptions(
	db: DbOrTx,
	officialIds: number[],
	seasonYear?: number
): Promise<SeasonAreaOptions> {
	const rows = await db
		.selectDistinct({
			seasonYear: competition.seasonYear,
			areaId: competition.areaId,
			areaName: area.name
		})
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.innerJoin(competition, eq(competition.id, game.competitionId))
		.leftJoin(area, eq(area.id, competition.areaId))
		.where(inArray(gameOfficial.officialId, officialIds));
	const seasons = [...new Set(rows.map((r) => r.seasonYear))]
		.filter((y): y is number => y !== null)
		.sort((a, b) => b - a);
	const areas = new Map<number, string>();
	for (const r of rows) {
		if (r.areaId === null) continue;
		if (seasonYear !== undefined && r.seasonYear !== seasonYear) continue;
		areas.set(r.areaId, areaLabel(r.areaId, r.areaName));
	}
	return {
		seasons,
		areas: [...areas].map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id)
	};
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
