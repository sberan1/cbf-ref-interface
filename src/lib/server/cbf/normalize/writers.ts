/**
 * Idempotent upserts of parsed ČBF data into the `cbf` schema. Every function runs inside the
 * normalization transaction of one raw payload.
 */
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import * as s from '../../db/schema';
import type {
	IdName,
	ParsedCompetition,
	ParsedGame,
	ParsedPerson,
	ParsedPhase,
	ParsedPlayerGameStats,
	ParsedRosterEntry,
	ParsedSeason,
	ParsedStanding,
	ParsedTeam,
	ParsedTeamGameStats,
	ParsedTeamRef,
	ParsedV1Competition,
	ParsedVenue,
	V1OfficialRef
} from '../parse/types';
import { diffDelegation, type CurrentDelegation, type DelegationMode } from './delegation';
import {
	chunk,
	excluded,
	existing,
	fillMissing,
	overwrite,
	preferIncoming,
	uniqueBy
} from './upsert';

const now = sql`now()`;
const BATCH = 500;
/** Namespace of transaction-scoped advisory locks taken per game (pg_advisory_xact_lock). */
const GAME_LOCK_NAMESPACE = 41_002;

/**
 * Serializes writes of the same games across parallel normalize consumers (games list, game detail
 * and v1 sched of one game can be normalized at the same time). Locks are taken in ID order.
 */
async function lockGames(tx: Tx, ids: number[]) {
	const sorted = [...new Set(ids)].sort((a, b) => a - b);
	for (const batch of chunk(sorted, BATCH)) {
		const values = sql.join(
			batch.map((id) => sql`(${id}::int)`),
			sql`, `
		);
		await tx.execute(sql`
			select pg_advisory_xact_lock(${GAME_LOCK_NAMESPACE}::int, g.id)
			from (select v.id from (values ${values}) as v(id) order by v.id) as g
		`);
	}
}

/**
 * Area names derived from the competitions each area returned in discovery (2026/27). Areas 9–11,
 * 13 and 14 returned nothing in 2026/27; 13 and 14 are named after ivosu/cbf_ical (unverified).
 */
export const knownAreas: Record<number, string> = {
	0: 'ČBF (celostátní)',
	1: 'Praha',
	2: 'Střední Čechy',
	3: 'Jižní Čechy',
	4: 'Západní Čechy',
	5: 'Severní Čechy',
	6: 'Východní Čechy',
	7: 'Jižní Morava',
	8: 'Severní Morava',
	12: 'Střední Morava',
	13: 'Karlovarský',
	14: 'Plzeňský'
};

export async function upsertSeasons(tx: Tx, seasons: ParsedSeason[]) {
	const rows = uniqueBy(seasons, (r) => r.id).map((r) => ({
		id: r.id,
		startYear: r.startYear,
		name: r.name,
		shortName: r.shortName,
		beginsOn: r.beginsOn,
		endsOn: r.endsOn,
		isCurrent: r.isCurrent,
		extra: r.raw
	}));
	if (!rows.length) return;
	await tx
		.insert(s.season)
		.values(rows)
		.onConflictDoUpdate({
			target: s.season.id,
			set: {
				...preferIncoming(s.season, [
					'startYear',
					'name',
					'shortName',
					'beginsOn',
					'endsOn',
					'isCurrent'
				]),
				extra: excluded(s.season, 'extra'),
				updatedAt: now
			}
		});
}

/** Season known only from a competition listing (sid/sname) – fills gaps, never overwrites. */
export async function upsertSeasonStub(
	tx: Tx,
	stub: { id: number; name: string | null; startYear: number | null }
) {
	await tx
		.insert(s.season)
		.values(stub)
		.onConflictDoUpdate({
			target: s.season.id,
			set: { ...fillMissing(s.season, ['name', 'startYear']), updatedAt: now }
		});
}

async function upsertCategories(tx: Tx, categories: IdName[]) {
	const rows = uniqueBy(categories, (c) => c.id);
	if (!rows.length) return;
	await tx
		.insert(s.category)
		.values(rows)
		.onConflictDoUpdate({
			target: s.category.id,
			set: { ...preferIncoming(s.category, ['name']), updatedAt: now }
		});
}

export async function upsertAreas(tx: Tx, ids: number[]) {
	const rows = [...new Set(ids)].map((id) => ({ id, name: knownAreas[id] ?? null }));
	if (!rows.length) return;
	await tx.insert(s.area).values(rows).onConflictDoNothing();
}

export async function upsertCompetitionsV2(
	tx: Tx,
	competitions: ParsedCompetition[],
	ctx: { seasonYear?: number; areaId?: number; female?: number }
) {
	const comps = uniqueBy(competitions, (c) => c.id);
	if (!comps.length) return;

	for (const stub of uniqueBy(
		comps.filter((c) => c.seasonId !== null),
		(c) => c.seasonId
	)) {
		await upsertSeasonStub(tx, {
			id: stub.seasonId as number,
			name: stub.seasonName,
			startYear: ctx.seasonYear ?? null
		});
	}

	await upsertCategories(
		tx,
		comps.flatMap((c) => (c.category ? [c.category] : []))
	);
	await upsertAreas(
		tx,
		comps.flatMap((c) => {
			const areaId = c.areaId ?? ctx.areaId;
			return areaId === undefined || areaId === null ? [] : [areaId];
		})
	);

	await tx
		.insert(s.competition)
		.values(
			comps.map((c) => ({
				id: c.id,
				seasonId: c.seasonId,
				seasonYear: ctx.seasonYear ?? null,
				areaId: c.areaId ?? ctx.areaId ?? null,
				isFemale: c.isFemale ?? (ctx.female === undefined ? null : ctx.female === 1),
				categoryId: c.category?.id ?? null,
				leagueId: c.league?.id ?? null,
				leagueName: c.league?.name ?? null,
				name: c.name,
				extra: c.raw
			}))
		)
		.onConflictDoUpdate({
			target: s.competition.id,
			set: {
				...preferIncoming(s.competition, [
					'seasonId',
					'seasonYear',
					'areaId',
					'isFemale',
					'categoryId',
					'leagueId',
					'leagueName',
					'name'
				]),
				extra: excluded(s.competition, 'extra'),
				updatedAt: now
			}
		});
}

export async function upsertCompetitionsV1(
	tx: Tx,
	competitions: ParsedV1Competition[],
	seasonYear: number | null
) {
	const comps = uniqueBy(competitions, (c) => c.id);
	if (!comps.length) return;
	await upsertCategories(
		tx,
		comps.flatMap((c) => (c.category ? [c.category] : []))
	);
	for (const batch of chunk(comps, BATCH)) {
		await tx
			.insert(s.competition)
			.values(
				batch.map((c) => ({
					id: c.id,
					name: c.name,
					seasonYear,
					categoryId: c.category?.id ?? null,
					leagueId: c.league?.id ?? null,
					leagueName: c.league?.name ?? null,
					flags: c.flags,
					extraV1: c.raw
				}))
			)
			.onConflictDoUpdate({
				target: s.competition.id,
				set: {
					...fillMissing(s.competition, [
						'name',
						'seasonYear',
						'categoryId',
						'leagueId',
						'leagueName'
					]),
					...overwrite(s.competition, ['flags', 'extraV1']),
					updatedAt: now
				}
			});
	}

	const phases = uniqueBy(
		comps.flatMap((c) =>
			c.phases.map((p) => ({ id: p.id, name: p.name, typeId: p.typeId, competitionId: c.id }))
		),
		(p) => p.id
	);
	for (const batch of chunk(phases, BATCH)) {
		await tx
			.insert(s.phase)
			.values(batch)
			.onConflictDoUpdate({
				target: s.phase.id,
				set: { ...fillMissing(s.phase, ['name', 'typeId', 'competitionId']), updatedAt: now }
			});
	}
}

export async function upsertPhases(
	tx: Tx,
	phases: ParsedPhase[],
	fallbackCompetitionId: number | null
) {
	const rows = uniqueBy(phases, (p) => p.id).map((p) => ({
		id: p.id,
		competitionId: p.competitionId ?? fallbackCompetitionId,
		name: p.name,
		typeId: p.typeId,
		typeName: p.typeName,
		extra: p.raw
	}));
	if (!rows.length) return;
	await tx
		.insert(s.phase)
		.values(rows)
		.onConflictDoUpdate({
			target: s.phase.id,
			set: {
				...preferIncoming(s.phase, ['competitionId', 'name', 'typeId', 'typeName']),
				extra: excluded(s.phase, 'extra'),
				updatedAt: now
			}
		});
}

/** Teams referenced from games/standings: create the row, fill the name, never overwrite. */
export async function upsertTeamStubs(tx: Tx, refs: ParsedTeamRef[]) {
	const rows = uniqueBy(
		refs.filter((r): r is ParsedTeamRef & { id: number } => r.id !== null),
		(r) => r.id
	).map((r) => ({ id: r.id, groupId: r.groupId, name: r.name, abbr: r.abbr }));
	for (const batch of chunk(rows, BATCH)) {
		await tx
			.insert(s.team)
			.values(batch)
			.onConflictDoUpdate({
				target: s.team.id,
				set: { ...fillMissing(s.team, ['groupId', 'name', 'abbr']), updatedAt: now }
			});
	}
}

export async function upsertCompetitionTeams(
	tx: Tx,
	rows: { competitionId: number; teamId: number; name: string | null; abbr: string | null }[]
) {
	const unique = uniqueBy(rows, (r) => `${r.competitionId}:${r.teamId}`);
	for (const batch of chunk(unique, BATCH)) {
		await tx
			.insert(s.competitionTeam)
			.values(batch)
			.onConflictDoUpdate({
				target: [s.competitionTeam.competitionId, s.competitionTeam.teamId],
				set: { ...preferIncoming(s.competitionTeam, ['name', 'abbr']), updatedAt: now }
			});
	}
}

export function venueKey(v: ParsedVenue): string {
	return [v.name, v.city]
		.map((part) => (part ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
		.join('|');
}

async function upsertVenues(tx: Tx, venues: ParsedVenue[]): Promise<Map<string, number>> {
	const ids = new Map<string, number>();
	for (const v of uniqueBy(venues, venueKey)) {
		const [row] = await tx
			.insert(s.venue)
			.values({ naturalKey: venueKey(v), ...v })
			.onConflictDoUpdate({
				target: s.venue.naturalKey,
				set: {
					...preferIncoming(s.venue, ['hallId', 'street', 'zip', 'lat', 'lon']),
					updatedAt: now
				}
			})
			.returning({ id: s.venue.id });
		ids.set(venueKey(v), row.id);
	}
	return ids;
}

export async function upsertOfficials(tx: Tx, persons: ParsedPerson[], seenAt: Date) {
	const rows = uniqueBy(persons, (p) => p.id).map((p) => ({
		id: p.id,
		groupId: p.groupId,
		firstName: p.firstName,
		lastName: p.lastName,
		lastSeenAt: seenAt
	}));
	for (const batch of chunk(rows, BATCH)) {
		await tx
			.insert(s.official)
			.values(batch)
			.onConflictDoUpdate({
				target: s.official.id,
				set: {
					...preferIncoming(s.official, ['groupId', 'firstName', 'lastName']),
					lastSeenAt: excluded(s.official, 'lastSeenAt'),
					updatedAt: now
				},
				setWhere: sql`${existing(s.official, 'lastSeenAt')} is null or ${excluded(s.official, 'lastSeenAt')} >= ${existing(s.official, 'lastSeenAt')}`
			});
	}
}

export type GameSource = 'v2.games' | 'v2.game' | 'v1.sched';

export interface GameWriteMeta {
	source: GameSource;
	observedAt: Date;
	rawPayloadId: number;
	phaseId?: number;
	competitionId?: number;
}

/** Upserts games with venues, team stubs, period scores and delegations. */
export async function writeGames(tx: Tx, parsed: ParsedGame[], meta: GameWriteMeta) {
	const games = uniqueBy(parsed, (g) => g.id);
	if (!games.length) return;
	await lockGames(
		tx,
		games.map((g) => g.id)
	);
	const isV1 = meta.source === 'v1.sched';
	const isDetail = meta.source === 'v2.game';
	const competitionOf = (g: ParsedGame) => g.competitionId ?? meta.competitionId ?? null;

	const venueIds = await upsertVenues(
		tx,
		games.flatMap((g) => (g.venue ? [g.venue] : []))
	);
	await upsertTeamStubs(
		tx,
		games.flatMap((g) => [g.home, g.away])
	);
	await upsertCompetitionTeams(
		tx,
		games.flatMap((g) => {
			const competitionId = competitionOf(g);
			if (competitionId === null) return [];
			return [g.home, g.away].flatMap((t) =>
				t.id === null ? [] : [{ competitionId, teamId: t.id, name: t.name, abbr: t.abbr }]
			);
		})
	);

	const rows = games.map((g) => ({
		id: g.id,
		phaseId: g.phaseId ?? meta.phaseId ?? null,
		competitionId: competitionOf(g),
		round: g.round,
		number: g.number,
		scheduledDate: g.scheduledDate,
		scheduledTime: g.scheduledTime,
		startsAt: g.startsAt,
		homeTeamId: g.home.id,
		awayTeamId: g.away.id,
		homeTeamName: g.home.name,
		awayTeamName: g.away.name,
		homeTeamAbbr: g.home.abbr,
		awayTeamAbbr: g.away.abbr,
		homeScore: g.homeScore,
		awayScore: g.awayScore,
		homePoints: g.homePoints,
		awayPoints: g.awayPoints,
		scoreQuartersRaw: g.quartersRaw,
		venueId: g.venue ? (venueIds.get(venueKey(g.venue)) ?? null) : null,
		urlLive: g.urlLive,
		videoUrl: g.videoUrl,
		isTv: g.isTv,
		resultChecked: g.resultChecked,
		attendance: g.attendance,
		...(isV1
			? { extraV1: g.raw }
			: {
					extra: g.raw,
					observedAt: meta.observedAt,
					detailFetchedAt: isDetail ? meta.observedAt : null
				})
	}));

	// Columns describing the current state of the game: the latest v2 observation wins, even NULL
	// (a postponed game loses its date). Descriptive columns keep old values when a source lacks them.
	const stateColumns = [
		'scheduledDate',
		'scheduledTime',
		'startsAt',
		'homeScore',
		'awayScore',
		'homePoints',
		'awayPoints',
		'round',
		'number'
	] as const;
	const descriptiveColumns = [
		'phaseId',
		'competitionId',
		'homeTeamId',
		'awayTeamId',
		'homeTeamName',
		'awayTeamName',
		'homeTeamAbbr',
		'awayTeamAbbr',
		'scoreQuartersRaw',
		'venueId',
		'urlLive',
		'videoUrl',
		'isTv',
		'resultChecked',
		'attendance'
	] as const;

	const written: number[] = [];
	for (const batch of chunk(rows, BATCH)) {
		const result = isV1
			? await tx
					.insert(s.game)
					.values(batch)
					.onConflictDoUpdate({
						target: s.game.id,
						set: {
							...fillMissing(s.game, [...stateColumns, ...descriptiveColumns]),
							extraV1: excluded(s.game, 'extraV1'),
							updatedAt: now
						}
					})
					.returning({ id: s.game.id })
			: await tx
					.insert(s.game)
					.values(batch)
					.onConflictDoUpdate({
						target: s.game.id,
						set: {
							...overwrite(s.game, [...stateColumns]),
							...preferIncoming(s.game, [...descriptiveColumns]),
							observedAt: excluded(s.game, 'observedAt'),
							...(isDetail
								? {
										extra: excluded(s.game, 'extra'),
										detailFetchedAt: excluded(s.game, 'detailFetchedAt')
									}
								: fillMissing(s.game, ['extra'])),
							updatedAt: now
						},
						setWhere: sql`${existing(s.game, 'observedAt')} is null or ${excluded(s.game, 'observedAt')} >= ${existing(s.game, 'observedAt')}`
					})
					.returning({ id: s.game.id });
		written.push(...result.map((r) => r.id));
	}

	const writtenIds = new Set(written);
	await writeQuarters(
		tx,
		games.filter((g) => writtenIds.has(g.id)),
		isV1
	);
	await writeDelegations(tx, games, meta, isV1 ? 'fill' : 'authoritative');
}

async function writeQuarters(tx: Tx, games: ParsedGame[], fillOnly: boolean) {
	const withQuarters = games.filter((g) => g.quarters.length > 0);
	if (!withQuarters.length) return;
	const rows = withQuarters.flatMap((g) =>
		uniqueBy(g.quarters, (q) => q.period).map((q) => ({ gameId: g.id, ...q }))
	);
	if (!fillOnly) {
		await tx.delete(s.gameScoreQuarter).where(
			inArray(
				s.gameScoreQuarter.gameId,
				withQuarters.map((g) => g.id)
			)
		);
	}
	for (const batch of chunk(rows, BATCH)) {
		await tx.insert(s.gameScoreQuarter).values(batch).onConflictDoNothing();
	}
}

async function writeDelegations(
	tx: Tx,
	games: ParsedGame[],
	meta: GameWriteMeta,
	mode: DelegationMode
) {
	const observedGames = games.filter((g) => g.officials.length > 0);
	if (!observedGames.length) return;
	const ids = observedGames.map((g) => g.id);

	const currentRows = await tx
		.select({
			gameId: s.gameOfficial.gameId,
			role: s.gameOfficial.role,
			officialId: s.gameOfficial.officialId,
			observedAt: s.gameOfficial.observedAt
		})
		.from(s.gameOfficial)
		.where(inArray(s.gameOfficial.gameId, ids));
	// newest history observation per role: a lower bound for stale snapshots, and roles without
	// history get their first assignment marked as the initial observation
	const lastChange = new Map<number, Map<s.OfficialRole, Date>>();
	const historyRows = await tx
		.select({
			gameId: s.gameOfficialHistory.gameId,
			role: s.gameOfficialHistory.role,
			last: max(s.gameOfficialHistory.observedAt)
		})
		.from(s.gameOfficialHistory)
		.where(inArray(s.gameOfficialHistory.gameId, ids))
		.groupBy(s.gameOfficialHistory.gameId, s.gameOfficialHistory.role);
	for (const row of historyRows) {
		if (!row.last) continue;
		const roles = lastChange.get(row.gameId) ?? new Map<s.OfficialRole, Date>();
		roles.set(row.role, row.last);
		lastChange.set(row.gameId, roles);
	}
	const currentByGame = new Map<number, CurrentDelegation[]>();
	for (const row of currentRows) {
		const list = currentByGame.get(row.gameId) ?? [];
		list.push(row);
		currentByGame.set(row.gameId, list);
	}

	const persons: ParsedPerson[] = [];
	const upserts: (typeof s.gameOfficial.$inferInsert)[] = [];
	const removals: { gameId: number; role: s.OfficialRole }[] = [];
	const history: (typeof s.gameOfficialHistory.$inferInsert)[] = [];
	const common = {
		source: meta.source,
		observedAt: meta.observedAt,
		rawPayloadId: meta.rawPayloadId
	};

	for (const game of observedGames) {
		const current = currentByGame.get(game.id) ?? [];
		const gameHistory = lastChange.get(game.id) ?? new Map<s.OfficialRole, Date>();
		for (const op of diffDelegation(current, game.officials, mode, meta.observedAt, gameHistory)) {
			if (op.type === 'remove') {
				removals.push({ gameId: game.id, role: op.role });
				history.push({
					gameId: game.id,
					role: op.role,
					changeType: 'removed',
					officialId: null,
					previousOfficialId: op.previousOfficialId,
					isInitial: false,
					...common
				});
				continue;
			}
			persons.push(op.official);
			upserts.push({
				gameId: game.id,
				role: op.role,
				officialId: op.official.id,
				firstName: op.official.firstName,
				lastName: op.official.lastName,
				...common
			});
			if (op.type === 'assign' || op.type === 'replace') {
				history.push({
					gameId: game.id,
					role: op.role,
					changeType: op.type === 'assign' ? 'assigned' : 'replaced',
					officialId: op.official.id,
					previousOfficialId: op.type === 'replace' ? op.previousOfficialId : null,
					isInitial: op.type === 'assign' && !gameHistory.has(op.role),
					...common
				});
			}
		}
	}

	await upsertOfficials(tx, persons, meta.observedAt);
	for (const batch of chunk(upserts, BATCH)) {
		await tx
			.insert(s.gameOfficial)
			.values(batch)
			.onConflictDoUpdate({
				target: [s.gameOfficial.gameId, s.gameOfficial.role],
				set: {
					...overwrite(s.gameOfficial, [
						'officialId',
						'firstName',
						'lastName',
						'source',
						'observedAt',
						'rawPayloadId'
					])
				}
			});
	}
	for (const r of removals) {
		await tx
			.delete(s.gameOfficial)
			.where(and(eq(s.gameOfficial.gameId, r.gameId), eq(s.gameOfficial.role, r.role)));
	}
	for (const batch of chunk(history, BATCH)) {
		await tx.insert(s.gameOfficialHistory).values(batch);
	}
}

export async function writeStandings(
	tx: Tx,
	phaseId: number,
	standings: ParsedStanding[],
	fallbackCompetitionId: number | null
) {
	const rows = uniqueBy(standings, (r) => r.teamId).map((r) => ({
		phaseId,
		teamId: r.teamId,
		competitionId: r.competitionId ?? fallbackCompetitionId,
		teamName: r.teamName,
		teamAbbr: r.teamAbbr,
		position: r.position,
		gamesPlayed: r.gamesPlayed,
		wins: r.wins,
		losses: r.losses,
		pointsFor: r.pointsFor,
		pointsAgainst: r.pointsAgainst,
		points: r.points,
		extra: r.raw
	}));
	if (!rows.length) return;
	await upsertTeamStubs(
		tx,
		standings.map((r) => ({
			id: r.teamId,
			groupId: r.teamGroupId,
			name: r.teamName,
			abbr: null
		}))
	);
	await upsertCompetitionTeams(
		tx,
		rows.flatMap((r) =>
			r.competitionId === null
				? []
				: [{ competitionId: r.competitionId, teamId: r.teamId, name: r.teamName, abbr: null }]
		)
	);
	await tx
		.insert(s.standing)
		.values(rows)
		.onConflictDoUpdate({
			target: [s.standing.phaseId, s.standing.teamId],
			set: {
				...overwrite(s.standing, [
					'competitionId',
					'teamName',
					'teamAbbr',
					'position',
					'gamesPlayed',
					'wins',
					'losses',
					'pointsFor',
					'pointsAgainst',
					'points',
					'extra'
				]),
				updatedAt: now
			}
		});
}

export async function writeTeam(tx: Tx, team: ParsedTeam, competitionId: number) {
	if (team.club) {
		await tx
			.insert(s.club)
			.values(team.club)
			.onConflictDoUpdate({
				target: s.club.id,
				set: { ...preferIncoming(s.club, ['name']), updatedAt: now }
			});
	}
	if (team.categoryId !== null) {
		await tx.insert(s.category).values({ id: team.categoryId }).onConflictDoNothing();
	}
	await tx
		.insert(s.team)
		.values({
			id: team.id,
			groupId: team.groupId,
			clubId: team.club?.id ?? null,
			categoryId: team.categoryId,
			name: team.name,
			shortName: team.shortName,
			abbr: team.abbr,
			isFemale: team.isFemale,
			web: team.web,
			email: team.email,
			street: team.street,
			city: team.city,
			zip: team.zip,
			phones: team.phones,
			extra: team.raw
		})
		.onConflictDoUpdate({
			target: s.team.id,
			set: {
				...preferIncoming(s.team, [
					'groupId',
					'clubId',
					'categoryId',
					'name',
					'shortName',
					'abbr',
					'isFemale',
					'web',
					'email',
					'street',
					'city',
					'zip'
				]),
				...overwrite(s.team, ['phones', 'extra']),
				updatedAt: now
			}
		});
	await upsertCompetitionTeams(tx, [
		{ competitionId, teamId: team.id, name: team.name, abbr: team.abbr }
	]);

	// contacts are a full list per team: replace them with the latest snapshot
	await tx.delete(s.teamContact).where(eq(s.teamContact.teamId, team.id));
	const contacts = uniqueBy(team.contacts, (c) => `${c.userId}:${c.role}`);
	if (contacts.length) {
		await tx
			.insert(s.teamContact)
			.values(contacts.map(({ raw, ...c }) => ({ teamId: team.id, ...c, extra: raw })));
	}
}

export async function writeRoster(
	tx: Tx,
	competitionId: number,
	teamId: number,
	entries: ParsedRosterEntry[]
) {
	const unique = uniqueBy(entries, (e) => e.player.id);
	if (!unique.length) return;
	await upsertTeamStubs(tx, [{ id: teamId, groupId: null, name: null, abbr: null }]);
	for (const batch of chunk(unique, BATCH)) {
		await tx
			.insert(s.player)
			.values(batch.map((e) => ({ ...e.player })))
			.onConflictDoUpdate({
				target: s.player.id,
				set: {
					...preferIncoming(s.player, ['groupId', 'firstName', 'lastName', 'height']),
					updatedAt: now
				}
			});
		await tx
			.insert(s.teamPlayer)
			.values(
				batch.map((e) => ({
					competitionId,
					teamId,
					playerId: e.player.id,
					jersey: e.jersey,
					stats: e.raw
				}))
			)
			.onConflictDoUpdate({
				target: [s.teamPlayer.competitionId, s.teamPlayer.teamId, s.teamPlayer.playerId],
				set: { ...overwrite(s.teamPlayer, ['jersey', 'stats']), updatedAt: now }
			});
	}
}

/**
 * v1 sched.php names officials by canonical person ID. Where v2 already knows who holds the same
 * role in the same game, under the same last name, the canonical ID is stored as
 * `official.group_id` (needed mainly for commissioners, whose v2 records carry no group ID). The
 * name check keeps a stale v1 document from linking a replaced official. Never overwrites.
 */
export async function linkOfficialGroups(tx: Tx, refs: V1OfficialRef[]) {
	const unique = uniqueBy(
		refs.filter((r) => r.lastName !== null),
		(r) => `${r.gameId}:${r.role}`
	);
	for (const batch of chunk(unique, BATCH)) {
		const values = sql.join(
			batch.map(
				(r) => sql`(${r.gameId}::int, ${r.role}::text, ${r.groupId}::int, ${r.lastName}::text)`
			),
			sql`, `
		);
		await tx.execute(sql`
			update ${s.official} as o
			set group_id = v.group_id, updated_at = now()
			from (values ${values}) as v(game_id, role, group_id, last_name)
			join ${s.gameOfficial} as go on go.game_id = v.game_id and go.role = v.role
			where o.id = go.official_id
				and o.group_id is null
				and lower(trim(o.last_name)) = lower(trim(v.last_name))
		`);
	}
}

/** Replaces the box score of one game (players and teams) from its latest game.php payload. */
export async function writeGameStats(
	tx: Tx,
	gameId: number,
	players: ParsedPlayerGameStats[],
	teams: ParsedTeamGameStats[]
) {
	const playerRows = uniqueBy(players, (p) => p.player.id);
	if (playerRows.length) {
		await tx
			.insert(s.player)
			.values(playerRows.map((p) => ({ ...p.player })))
			.onConflictDoUpdate({
				target: s.player.id,
				set: { ...preferIncoming(s.player, ['groupId', 'firstName', 'lastName']), updatedAt: now }
			});
	}
	await tx.delete(s.playerGameStats).where(eq(s.playerGameStats.gameId, gameId));
	for (const batch of chunk(playerRows, BATCH)) {
		await tx.insert(s.playerGameStats).values(
			batch.map((p) => ({
				gameId,
				playerId: p.player.id,
				teamId: p.teamId,
				jersey: p.jersey,
				stats: p.raw
			}))
		);
	}

	const teamRows = uniqueBy(teams, (t) => t.teamId);
	await upsertTeamStubs(
		tx,
		teamRows.map((t) => ({ id: t.teamId, groupId: t.groupId, name: null, abbr: null }))
	);
	await tx.delete(s.gameTeamStats).where(eq(s.gameTeamStats.gameId, gameId));
	if (teamRows.length) {
		await tx
			.insert(s.gameTeamStats)
			.values(
				teamRows.map((t) => ({ gameId, teamId: t.teamId, isGuest: t.isGuest, stats: t.raw }))
			);
	}
}
