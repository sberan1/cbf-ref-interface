/**
 * Parsers for the undocumented v2 export (https://cbf.cz/xml/api/*.php?json=1). Field names were
 * verified against live samples by discovery on 2026-10-14 (seasons 2026/27 and 2012/13), see
 * docs/agent-context/history/20261014-scaffold-cbf-ingestu.md.
 */
import type { OfficialRole } from '../../db/schema';
import {
	bool01,
	cbfDate,
	cbfTime,
	hasAnyKey,
	id,
	int,
	isRec,
	num,
	parseScoreTokens,
	periodsFromCumulative,
	pick,
	pragueToUtc,
	scorePair,
	str,
	type Rec
} from './coerce';
import { asRecordArray, CbfParseError, decodePayload, xmlList, xmlRoot } from './payload';
import type {
	IdName,
	ObservedOfficial,
	ParsedCompetition,
	ParsedGame,
	ParsedGameDetail,
	ParsedPhase,
	ParsedPlayerGameStats,
	ParsedRosterEntry,
	ParsedSeason,
	ParsedStanding,
	ParsedTeam,
	ParsedTeamContact,
	ParsedTeamGameStats,
	ParsedVenue
} from './types';

function jsonRecords(body: string): Rec[] {
	const payload = decodePayload(body);
	if (payload.format === 'empty') return [];
	if (payload.format !== 'json') throw new CbfParseError(`Expected JSON, got ${payload.format}`);
	return asRecordArray(payload.data);
}

function jsonObject(body: string): Rec | null {
	const payload = decodePayload(body);
	if (payload.format === 'empty') return null;
	if (payload.format !== 'json') throw new CbfParseError(`Expected JSON, got ${payload.format}`);
	if (payload.data === null || payload.data === false) return null;
	if (!isRec(payload.data)) throw new CbfParseError('Expected a JSON object');
	return payload.data;
}

function idName(idValue: unknown, nameValue: unknown): IdName | null {
	const value = id(idValue);
	return value === null ? null : { id: value, name: str(nameValue) };
}

export function startYearFromName(name: string | null): number | null {
	const m = name ? /(\d{4})/.exec(name) : null;
	return m ? Number(m[1]) : null;
}

/**
 * seasonList.php – <season><IDseason/><name>2026/27</name><short_name>2026</short_name>
 * <date_of_begin/><date_of_end/><current/></season>; with json=1 the same as a JSON array.
 */
export function parseV2SeasonList(body: string): ParsedSeason[] {
	const payload = decodePayload(body);
	let records: Rec[] = [];
	if (payload.format === 'xml') records = xmlList(xmlRoot(payload.data).season);
	else if (payload.format === 'json') records = asRecordArray(payload.data);
	return records.flatMap((rec) => {
		const seasonId = id(pick(rec, 'IDseason', 'sid'));
		if (seasonId === null) return [];
		const name = str(rec.name);
		const shortName = str(rec.short_name);
		return [
			{
				id: seasonId,
				startYear: int(shortName) ?? startYearFromName(name),
				name,
				shortName,
				beginsOn: cbfDate(rec.date_of_begin),
				endsOn: cbfDate(rec.date_of_end),
				isCurrent: bool01(rec.current),
				raw: rec
			}
		];
	});
}

/**
 * divs.php?season=&female=&area= – competitions of one area and gender (compid, cname, catid,
 * catname, cgid/cgname = league, sid = IDseason, area, …). Areas do not overlap.
 */
export function parseV2Divs(body: string): ParsedCompetition[] {
	return jsonRecords(body).flatMap((rec) => {
		const compId = id(rec.compid);
		if (compId === null) return [];
		return [
			{
				id: compId,
				name: str(rec.cname),
				seasonId: id(rec.sid),
				seasonName: str(rec.sname),
				areaId: int(rec.area),
				isFemale: bool01(rec.female),
				category: idName(rec.catid, rec.catname),
				league: idName(rec.cgid, rec.cgname),
				raw: rec
			}
		];
	});
}

/** phases.php?competition= – (id, name, short_cut, typename, IDphaseType, IDcompetition, …). */
export function parseV2Phases(body: string): ParsedPhase[] {
	return jsonRecords(body).flatMap((rec) => {
		const phaseId = id(rec.id);
		if (phaseId === null) return [];
		return [
			{
				id: phaseId,
				competitionId: id(rec.IDcompetition),
				name: str(rec.name),
				typeId: id(rec.IDphaseType),
				typeName: str(rec.typename),
				raw: rec
			}
		];
	});
}

const v2OfficialKeys: [OfficialRole, string][] = [
	['referee1', 'u1'],
	['referee2', 'u2'],
	['referee3', 'u3']
];

/**
 * Referees are only in game.php (`uNid`, `uNn1` first name, `uNn2` last name, `uNgroup`);
 * games.php carries just the commissioner. `uNid = 0` with a name ("Delegováno") means the
 * delegation exists but is not published yet → unknown, not vacant.
 */
function parseV2Officials(rec: Rec): ObservedOfficial[] {
	const observed: ObservedOfficial[] = [];
	for (const [role, p] of v2OfficialKeys) {
		if (!hasAnyKey(rec, `${p}id`)) continue;
		const personId = id(rec[`${p}id`]);
		const firstName = str(rec[`${p}n1`]);
		const lastName = str(rec[`${p}n2`]);
		if (personId === null) {
			if (firstName === null && lastName === null) observed.push({ role, official: null });
			continue;
		}
		observed.push({
			role,
			official: { id: personId, groupId: id(rec[`${p}group`]), firstName, lastName }
		});
	}
	if (hasAnyKey(rec, 'commisarid')) {
		const personId = id(rec.commisarid);
		const firstName = str(rec.commisarn1);
		const lastName = str(rec.commisarn2);
		if (personId !== null) {
			observed.push({
				role: 'commissioner',
				official: { id: personId, groupId: null, firstName, lastName }
			});
		} else if (firstName === null && lastName === null) {
			observed.push({ role: 'commissioner', official: null });
		}
	}
	return observed;
}

function parseVenue(rec: Rec): ParsedVenue | null {
	const venue = {
		hallId: id(rec.IDhall),
		name: str(rec.place),
		street: str(rec.street),
		city: str(rec.city),
		zip: str(rec.zipcode),
		lat: num(rec.lat),
		lon: num(rec.lon)
	};
	return venue.name || venue.city ? venue : null;
}

/** One game record as found in games.php (list) and game.php (gameInfo[0]). */
export function mapV2Game(rec: Rec): ParsedGame | null {
	const gameId = id(pick(rec, 'IDgame', 'gid'));
	if (gameId === null) return null;
	const scheduledDate = cbfDate(rec.gdate);
	const scheduledTime = cbfTime(rec.gtime);
	const [homeScore, awayScore] = scorePair(rec.score_home, rec.score_guest);
	const tokens = parseScoreTokens(rec.score_quarter);
	return {
		id: gameId,
		phaseId: id(rec.IDphase),
		competitionId: id(rec.IDcompetition),
		round: str(rec.round),
		number: str(rec.num),
		scheduledDate,
		scheduledTime,
		startsAt: pragueToUtc(scheduledDate, scheduledTime),
		// taabbr is the full name too; ateams2 is the short code (UNL, PIS)
		home: {
			id: id(rec.taidteam),
			groupId: id(rec.tagroupby),
			name: str(rec.taname),
			abbr: str(rec.ateams2)
		},
		away: {
			id: id(rec.tbidteam),
			groupId: id(rec.tbgroupby),
			name: str(rec.tbname),
			abbr: str(rec.bteams2)
		},
		homeScore,
		awayScore,
		homePoints: int(rec.points_home),
		awayPoints: int(rec.points_guest),
		// only complete sequences (Q1–Q3, +Q4 with overtime) are converted; others stay raw
		quarters:
			homeScore !== null && tokens.length >= 3
				? periodsFromCumulative(tokens, [homeScore, awayScore])
				: [],
		quartersRaw: str(rec.score_quarter),
		venue: parseVenue(rec),
		urlLive: str(rec.url_live),
		videoUrl: str(pick(rec, 'embed_url', 'videoIFrame')),
		isTv: bool01(rec.ct4),
		resultChecked: bool01(rec.checked),
		// ČBF sends 0 when the attendance was not reported
		attendance: id(rec.num_visitors),
		officials: parseV2Officials(rec),
		raw: rec
	};
}

/** games.php?phase= – all games of a phase (with commissioner, without referees). */
export function parseV2Games(body: string): ParsedGame[] {
	return jsonRecords(body).flatMap((rec) => mapV2Game(rec) ?? []);
}

function parsePlayerStats(rec: Rec): ParsedPlayerGameStats | null {
	const playerId = id(rec.IDuser);
	if (playerId === null) return null;
	return {
		player: {
			id: playerId,
			groupId: id(rec.groupby),
			firstName: str(rec.first_name),
			lastName: str(rec.last_name)
		},
		teamId: id(rec.IDteam),
		jersey: str(rec.number),
		isGuest: bool01(rec.GUEST),
		raw: rec
	};
}

function parseTeamStats(rec: Rec): ParsedTeamGameStats | null {
	const teamId = id(rec.IDteam);
	if (teamId === null) return null;
	return { teamId, groupId: id(rec.groupby), isGuest: bool01(rec.GUEST), raw: rec };
}

/** game.php?game= – { gameInfo: [game], playerStats: [...], teamStats: [...] }. */
export function parseV2GameDetail(body: string): ParsedGameDetail {
	const payload = jsonObject(body);
	if (!payload) return { game: null, players: [], teams: [] };
	const info = asRecordArray(payload.gameInfo)[0];
	return {
		game: info ? mapV2Game(info) : null,
		players: asRecordArray(payload.playerStats).flatMap((r) => parsePlayerStats(r) ?? []),
		teams: asRecordArray(payload.teamStats).flatMap((r) => parseTeamStats(r) ?? [])
	};
}

/**
 * table.php?phase= – standings (tid, gr/group = team group, countmatch, countwin, countloose,
 * sumscore1/2, sumpoints = table points or win % in NBL, position, …).
 */
export function parseV2Table(body: string): ParsedStanding[] {
	return jsonRecords(body).flatMap((rec) => {
		const teamId = id(rec.tid);
		if (teamId === null) return [];
		return [
			{
				teamId,
				teamGroupId: id(pick(rec, 'group', 'gr')),
				competitionId: id(rec.cid),
				teamName: str(rec.tname),
				teamAbbr: str(rec.abbr),
				position: int(rec.position),
				gamesPlayed: int(rec.countmatch),
				wins: int(rec.countwin),
				losses: int(rec.countloose),
				pointsFor: int(rec.sumscore1),
				pointsAgainst: int(rec.sumscore2),
				points: num(rec.sumpoints),
				raw: rec
			}
		];
	});
}

function parseTeamContact(rec: Rec): ParsedTeamContact | null {
	const userId = id(rec.IDuser);
	if (userId === null) return null;
	const isMale = bool01(rec.is_male);
	return {
		userId,
		groupId: id(rec.groupby),
		role: str(rec.name) ?? '',
		firstName: str(rec.first_name),
		lastName: str(rec.last_name),
		degreePrefix: str(rec.degree_prefix),
		degreeSuffix: str(rec.degree_suffix),
		isMale,
		birthDate: cbfDate(rec.birthdate),
		street: str(rec.street),
		houseNumber: str(rec.c_p),
		city: str(rec.city),
		zip: str(rec.psc),
		phones: [str(rec.phone_1), str(rec.phone_2), str(rec.phone_3)].filter(
			(p): p is string => p !== null
		),
		email: str(rec.email),
		validFrom: cbfDate(rec.date_of_begin),
		validTo: cbfDate(rec.date_of_end),
		raw: rec
	};
}

/**
 * team.php?id=&competition= – { info: [team], contact: [club officials], match: [...],
 * matchaggr: [...] }.
 */
export function parseV2Team(body: string): ParsedTeam | null {
	const payload = jsonObject(body);
	if (!payload) return null;
	const rec = asRecordArray(payload.info)[0];
	if (!rec) return null;
	const teamId = id(rec.IDteam);
	if (teamId === null) return null;
	const isMale = bool01(rec.is_male);
	return {
		id: teamId,
		groupId: id(rec.groupby),
		name: str(rec.name),
		shortName: str(rec.short_name),
		abbr: str(rec.short_name2),
		isFemale: isMale === null ? null : !isMale,
		web: str(rec.www),
		email: str(rec.email),
		street: str(rec.street),
		city: str(rec.city),
		zip: str(rec.psc),
		phones: [str(rec.phone_1), str(rec.phone_2)].filter((p): p is string => p !== null),
		categoryId: id(rec.IDcategory),
		club: idName(rec.IDclub, rec.clubname),
		contacts: asRecordArray(payload.contact).flatMap((c) => parseTeamContact(c) ?? []),
		raw: rec
	};
}

/**
 * teamplayers.php?id=&competition= – { info: [team], playerstatcount: [player + season stats],
 * playerstatcounttotal, playerstatcountpercent, ztotal }.
 */
export function parseV2TeamPlayers(body: string): ParsedRosterEntry[] {
	const payload = jsonObject(body);
	if (!payload) return [];
	return asRecordArray(payload.playerstatcount).flatMap((rec) => {
		const playerId = id(rec.IDplayer);
		if (playerId === null) return [];
		return [
			{
				player: {
					id: playerId,
					groupId: id(rec.groupby),
					firstName: str(rec.first_name),
					lastName: str(rec.last_name),
					height: id(rec.height)
				},
				jersey: str(rec.num_of_dress),
				raw: rec
			}
		];
	});
}
