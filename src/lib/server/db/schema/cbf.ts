/**
 * Normalized mirror of ČBF data (ADR 0001, 0004).
 *
 * - Primary keys are v2 IDs of ČBF. v1 shares IDs of competitions, phases and games, but uses
 *   "group" IDs for people and teams (v2 `uNgroup` / `groupby`), stored in `group_id` columns.
 * - Cross-aggregate references (game → phase, phase → competition, …) are indexed columns without
 *   FK constraints: payloads arrive in any order and are re-normalized independently.
 *   FKs exist only inside an aggregate written in one transaction (game → quarters/officials).
 * - `extra` keeps the full source record (v2), `extra_v1` the v1 XML record, so nothing from the
 *   export is lost even before the mapping is verified by discovery.
 */
import {
	bigint,
	bigserial,
	boolean,
	date,
	doublePrecision,
	index,
	integer,
	jsonb,
	numeric,
	pgSchema,
	primaryKey,
	serial,
	text,
	timestamp
} from 'drizzle-orm/pg-core';

export const cbfSchema = pgSchema('cbf');

type Json = Record<string, unknown>;

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const timestamps = () => ({
	firstSeenAt: tstz('first_seen_at').notNull().defaultNow(),
	updatedAt: tstz('updated_at').notNull().defaultNow()
});

export const season = cbfSchema.table(
	'season',
	{
		id: integer('id').primaryKey(),
		/** Start year = value of the `season` / `s` request parameter (verified by discovery). */
		startYear: integer('start_year'),
		name: text('name'),
		shortName: text('short_name'),
		beginsOn: date('begins_on', { mode: 'string' }),
		endsOn: date('ends_on', { mode: 'string' }),
		isCurrent: boolean('is_current'),
		extra: jsonb('extra').$type<Json>(),
		...timestamps()
	},
	(t) => [index('season_start_year_idx').on(t.startYear)]
);

export const area = cbfSchema.table('area', {
	/** 0 = national (celostátní), 1–14 = regional associations (2026: 1–8 and 12 in use). */
	id: integer('id').primaryKey(),
	name: text('name'),
	...timestamps()
});

/** Age/gender category (muži, U19M, …). */
export const category = cbfSchema.table('category', {
	id: integer('id').primaryKey(),
	name: text('name'),
	...timestamps()
});

export const competition = cbfSchema.table(
	'competition',
	{
		id: integer('id').primaryKey(),
		seasonId: integer('season_id'),
		seasonYear: integer('season_year'),
		areaId: integer('area_id'),
		isFemale: boolean('is_female'),
		categoryId: integer('category_id'),
		/** League / competition group (v2 `cgid` / `cgname`, v1 `<league>`), e.g. NBL, Oblasti. */
		leagueId: integer('league_id'),
		leagueName: text('league_name'),
		name: text('name'),
		/** v1 flags (public, finished, refeval, sups, …) as booleans. */
		flags: jsonb('flags').$type<Record<string, boolean | null>>(),
		extra: jsonb('extra').$type<Json>(),
		extraV1: jsonb('extra_v1').$type<Json>(),
		...timestamps()
	},
	(t) => [
		index('competition_season_year_idx').on(t.seasonYear),
		index('competition_area_idx').on(t.areaId)
	]
);

export const phase = cbfSchema.table(
	'phase',
	{
		id: integer('id').primaryKey(),
		competitionId: integer('competition_id'),
		name: text('name'),
		typeId: integer('type_id'),
		typeName: text('type_name'),
		extra: jsonb('extra').$type<Json>(),
		...timestamps()
	},
	(t) => [index('phase_competition_idx').on(t.competitionId)]
);

export const club = cbfSchema.table('club', {
	id: integer('id').primaryKey(),
	name: text('name'),
	...timestamps()
});

export const team = cbfSchema.table(
	'team',
	{
		id: integer('id').primaryKey(),
		/** Team lineage across seasons (v2 `groupby`, = team ID in v1 sched.php). */
		groupId: integer('group_id'),
		clubId: integer('club_id'),
		categoryId: integer('category_id'),
		name: text('name'),
		shortName: text('short_name'),
		abbr: text('abbr'),
		isFemale: boolean('is_female'),
		web: text('web'),
		email: text('email'),
		street: text('street'),
		city: text('city'),
		zip: text('zip'),
		phones: text('phones').array(),
		extra: jsonb('extra').$type<Json>(),
		...timestamps()
	},
	(t) => [index('team_club_idx').on(t.clubId), index('team_group_idx').on(t.groupId)]
);

/** Club officials of a team as listed by team.php (`contact`), replaced on every fetch. */
export const teamContact = cbfSchema.table(
	'team_contact',
	{
		teamId: integer('team_id').notNull(),
		/** v2 user ID of the person */
		userId: integer('user_id').notNull(),
		/** Function in the club (e.g. "organizační pracovník"); '' when not given. */
		role: text('role').notNull(),
		groupId: integer('group_id'),
		firstName: text('first_name'),
		lastName: text('last_name'),
		degreePrefix: text('degree_prefix'),
		degreeSuffix: text('degree_suffix'),
		isMale: boolean('is_male'),
		birthDate: date('birth_date', { mode: 'string' }),
		street: text('street'),
		houseNumber: text('house_number'),
		city: text('city'),
		zip: text('zip'),
		phones: text('phones').array(),
		email: text('email'),
		validFrom: date('valid_from', { mode: 'string' }),
		validTo: date('valid_to', { mode: 'string' }),
		extra: jsonb('extra').$type<Json>(),
		...timestamps()
	},
	(t) => [
		primaryKey({ columns: [t.teamId, t.userId, t.role] }),
		index('team_contact_user_idx').on(t.userId)
	]
);

/** Team participation in a competition, with the name it played under (sponsor names change). */
export const competitionTeam = cbfSchema.table(
	'competition_team',
	{
		competitionId: integer('competition_id').notNull(),
		teamId: integer('team_id').notNull(),
		name: text('name'),
		abbr: text('abbr'),
		...timestamps()
	},
	(t) => [
		primaryKey({ columns: [t.competitionId, t.teamId] }),
		index('competition_team_team_idx').on(t.teamId)
	]
);

/**
 * Venues are keyed by normalized name|city, the only fields present in every source (games list,
 * game detail, v1 sched); the hall ID (`IDhall`) is known only from game detail.
 */
export const venue = cbfSchema.table('venue', {
	id: serial('id').primaryKey(),
	naturalKey: text('natural_key').notNull().unique(),
	hallId: integer('hall_id'),
	name: text('name'),
	street: text('street'),
	city: text('city'),
	zip: text('zip'),
	lat: doublePrecision('lat'),
	lon: doublePrecision('lon'),
	...timestamps()
});

export const game = cbfSchema.table(
	'game',
	{
		id: integer('id').primaryKey(),
		phaseId: integer('phase_id'),
		competitionId: integer('competition_id'),
		round: text('round'),
		number: text('number'),
		/** Local (Europe/Prague) date; NULL when ČBF sends 0000-00-00 (not scheduled yet). */
		scheduledDate: date('scheduled_date', { mode: 'string' }),
		/** Local (Europe/Prague) time as sent by ČBF. */
		scheduledTime: text('scheduled_time'),
		/** UTC instant derived from scheduled date + time; NULL when either is unknown. */
		startsAt: tstz('starts_at'),
		homeTeamId: integer('home_team_id'),
		awayTeamId: integer('away_team_id'),
		homeTeamName: text('home_team_name'),
		awayTeamName: text('away_team_name'),
		homeTeamAbbr: text('home_team_abbr'),
		awayTeamAbbr: text('away_team_abbr'),
		homeScore: integer('home_score'),
		awayScore: integer('away_score'),
		/** Table points awarded for the game (e.g. 2/1). */
		homePoints: integer('home_points'),
		awayPoints: integer('away_points'),
		scoreQuartersRaw: text('score_quarters_raw'),
		venueId: integer('venue_id').references(() => venue.id),
		urlLive: text('url_live'),
		videoUrl: text('video_url'),
		isTv: boolean('is_tv'),
		/** Result confirmed by ČBF (`checked`). */
		resultChecked: boolean('result_checked'),
		attendance: integer('attendance'),
		extra: jsonb('extra').$type<Json>(),
		extraV1: jsonb('extra_v1').$type<Json>(),
		/** Fetch time of the v2 payload the row reflects; older payloads never overwrite newer ones. */
		observedAt: tstz('observed_at'),
		detailFetchedAt: tstz('detail_fetched_at'),
		...timestamps()
	},
	(t) => [
		index('game_phase_idx').on(t.phaseId),
		index('game_competition_idx').on(t.competitionId),
		index('game_starts_at_idx').on(t.startsAt),
		index('game_home_team_idx').on(t.homeTeamId),
		index('game_away_team_idx').on(t.awayTeamId)
	]
);

/**
 * Points scored per period, derived from the cumulative `score_quarter` + final score.
 * Periods 1–4 are quarters; period 5 holds all overtimes together (ČBF does not split them).
 */
export const gameScoreQuarter = cbfSchema.table(
	'game_score_quarter',
	{
		gameId: integer('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		period: integer('period').notNull(),
		home: integer('home'),
		away: integer('away')
	},
	(t) => [primaryKey({ columns: [t.gameId, t.period] })]
);

/**
 * Referees and commissioners. `id` = v2 user ID (`uNid` / `commisarid`), stable across seasons
 * (verified on 2012 vs 2026 samples). `group_id` = canonical person ID used by v1 (`uNgroup`).
 */
export const official = cbfSchema.table(
	'official',
	{
		id: integer('id').primaryKey(),
		groupId: integer('group_id'),
		firstName: text('first_name'),
		lastName: text('last_name'),
		lastSeenAt: tstz('last_seen_at'),
		...timestamps()
	},
	(t) => [index('official_group_idx').on(t.groupId)]
);

export const officialRoles = ['referee1', 'referee2', 'referee3', 'commissioner'] as const;
export type OfficialRole = (typeof officialRoles)[number];

/** Current delegation of a game. */
export const gameOfficial = cbfSchema.table(
	'game_official',
	{
		gameId: integer('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		role: text('role').$type<OfficialRole>().notNull(),
		officialId: integer('official_id')
			.notNull()
			.references(() => official.id),
		/** Name exactly as published for this game. */
		firstName: text('first_name'),
		lastName: text('last_name'),
		source: text('source').notNull(),
		observedAt: tstz('observed_at').notNull(),
		rawPayloadId: bigint('raw_payload_id', { mode: 'number' })
	},
	(t) => [
		primaryKey({ columns: [t.gameId, t.role] }),
		index('game_official_official_idx').on(t.officialId)
	]
);

/** Delegation changes derived from successive snapshots (ADR 0001 §3). */
export const gameOfficialHistory = cbfSchema.table(
	'game_official_history',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		gameId: integer('game_id').notNull(),
		role: text('role').$type<OfficialRole>().notNull(),
		changeType: text('change_type').$type<'assigned' | 'replaced' | 'removed'>().notNull(),
		officialId: integer('official_id'),
		previousOfficialId: integer('previous_official_id'),
		/** True for the first official ever observed in this role of the game (not a real change). */
		isInitial: boolean('is_initial').notNull(),
		source: text('source').notNull(),
		observedAt: tstz('observed_at').notNull(),
		rawPayloadId: bigint('raw_payload_id', { mode: 'number' })
	},
	(t) => [
		index('game_official_history_game_idx').on(t.gameId),
		index('game_official_history_official_idx').on(t.officialId)
	]
);

export const standing = cbfSchema.table(
	'standing',
	{
		phaseId: integer('phase_id').notNull(),
		teamId: integer('team_id').notNull(),
		competitionId: integer('competition_id'),
		teamName: text('team_name'),
		teamAbbr: text('team_abbr'),
		position: integer('position'),
		gamesPlayed: integer('games_played'),
		wins: integer('wins'),
		losses: integer('losses'),
		pointsFor: integer('points_for'),
		pointsAgainst: integer('points_against'),
		/** Table points; NBL sends win percentage as a float here. */
		points: numeric('points', { mode: 'number' }),
		extra: jsonb('extra').$type<Json>(),
		...timestamps()
	},
	(t) => [primaryKey({ columns: [t.phaseId, t.teamId] })]
);

/** Players; `id` = v2 user ID (`IDplayer` / `IDuser`), `group_id` = canonical person (`groupby`). */
export const player = cbfSchema.table(
	'player',
	{
		id: integer('id').primaryKey(),
		groupId: integer('group_id'),
		firstName: text('first_name'),
		lastName: text('last_name'),
		height: integer('height'),
		...timestamps()
	},
	(t) => [index('player_group_idx').on(t.groupId)]
);

/** Roster entry from teamplayers.php, including the competition stats it returns. */
export const teamPlayer = cbfSchema.table(
	'team_player',
	{
		competitionId: integer('competition_id').notNull(),
		teamId: integer('team_id').notNull(),
		playerId: integer('player_id')
			.notNull()
			.references(() => player.id),
		jersey: text('jersey'),
		stats: jsonb('stats').$type<Json>(),
		...timestamps()
	},
	(t) => [
		primaryKey({ columns: [t.competitionId, t.teamId, t.playerId] }),
		index('team_player_player_idx').on(t.playerId)
	]
);

/** Per-game player box score from game.php `playerStats` (ČBF codes, e.g. ZS2PP = 2PT made). */
export const playerGameStats = cbfSchema.table(
	'player_game_stats',
	{
		gameId: integer('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		playerId: integer('player_id')
			.notNull()
			.references(() => player.id),
		teamId: integer('team_id'),
		jersey: text('jersey'),
		stats: jsonb('stats').$type<Json>(),
		...timestamps()
	},
	(t) => [
		primaryKey({ columns: [t.gameId, t.playerId] }),
		index('player_game_stats_player_idx').on(t.playerId)
	]
);

/** Per-game team box score from game.php `teamStats`. */
export const gameTeamStats = cbfSchema.table(
	'game_team_stats',
	{
		gameId: integer('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		teamId: integer('team_id').notNull(),
		isGuest: boolean('is_guest'),
		stats: jsonb('stats').$type<Json>(),
		...timestamps()
	},
	(t) => [primaryKey({ columns: [t.gameId, t.teamId] })]
);
