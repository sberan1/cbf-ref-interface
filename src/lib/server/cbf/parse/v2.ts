/**
 * Parsers for the undocumented v2 export (https://www.cbf.cz/xml/api/*.php?json=1).
 * Field names come from the public clients (jknetl/CzechBasketballSchedule, ivosu/cbf_ical);
 * entries marked PROVISIONAL are guesses to be confirmed by `npm run cbf -- discover`.
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
	parseScoreQuarters,
	pick,
	pragueToUtc,
	scorePair,
	str,
	type Rec
} from './coerce';
import { asRecordArray, CbfParseError, decodePayload, xmlList, xmlRoot } from './payload';
import type {
	ObservedOfficial,
	ParsedCompetition,
	ParsedGame,
	ParsedPhase,
	ParsedRosterEntry,
	ParsedSeason,
	ParsedStanding,
	ParsedTeam,
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

export function startYearFromName(name: string | null): number | null {
	const m = name ? /(\d{4})/.exec(name) : null;
	return m ? Number(m[1]) : null;
}

/** seasonList.php – XML <season><IDseason/><name/><short_name/><current/></season> (or JSON). */
export function parseV2SeasonList(body: string): ParsedSeason[] {
	const payload = decodePayload(body);
	let records: Rec[] = [];
	if (payload.format === 'xml') records = xmlList(xmlRoot(payload.data).season);
	else if (payload.format === 'json') records = asRecordArray(payload.data);
	return records.flatMap((rec) => {
		const seasonId = id(pick(rec, 'IDseason', 'id', 'sid'));
		if (seasonId === null) return [];
		const name = str(pick(rec, 'name', 'sname'));
		return [
			{
				id: seasonId,
				startYear: startYearFromName(name),
				name,
				shortName: str(rec.short_name),
				isCurrent: bool01(rec.current),
				raw: rec
			}
		];
	});
}

/** divs.php?season=&female=&area= – competitions (compid, cname, catid, catname, sid, sname, …). */
export function parseV2Divs(body: string): ParsedCompetition[] {
	return jsonRecords(body).flatMap((rec) => {
		const compId = id(pick(rec, 'compid', 'IDcompetition', 'id'));
		if (compId === null) return [];
		const categoryId = id(rec.catid);
		return [
			{
				id: compId,
				name: str(pick(rec, 'cname', 'name')),
				seasonId: id(rec.sid),
				seasonName: str(rec.sname),
				isFemale: bool01(rec.female),
				category:
					categoryId === null
						? null
						: {
								id: categoryId,
								name: str(rec.catname),
								groupId: id(rec.cgid),
								groupName: str(rec.cgname)
							},
				raw: rec
			}
		];
	});
}

/** phases.php?competition= – (id, name, typename, IDphaseType, IDcompetition). */
export function parseV2Phases(body: string): ParsedPhase[] {
	return jsonRecords(body).flatMap((rec) => {
		const phaseId = id(pick(rec, 'id', 'IDphase'));
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

function parsePerson(rec: Rec, idKey: string, firstKey: string, lastKey: string) {
	const personId = id(rec[idKey]);
	if (personId === null) return null;
	return { id: personId, firstName: str(rec[firstKey]), lastName: str(rec[lastKey]) };
}

const v2OfficialKeys: [OfficialRole, string, string, string][] = [
	['referee1', 'u1id', 'u1n1', 'u1n2'],
	['referee2', 'u2id', 'u2n1', 'u2n2'],
	['referee3', 'u3id', 'u3n1', 'u3n2'],
	['commissioner', 'commisarid', 'commisarn1', 'commisarn2']
];

function parseV2Officials(rec: Rec): ObservedOfficial[] {
	return v2OfficialKeys
		.filter(([, idKey]) => hasAnyKey(rec, idKey))
		.map(([role, idKey, firstKey, lastKey]) => ({
			role,
			official: parsePerson(rec, idKey, firstKey, lastKey)
		}));
}

function parseVenue(rec: Rec): ParsedVenue | null {
	const venue = {
		name: str(rec.place),
		street: str(rec.street),
		city: str(rec.city),
		zip: str(rec.zipcode),
		lat: num(rec.lat),
		lon: num(rec.lon)
	};
	return venue.name || venue.city || venue.street ? venue : null;
}

/** One game record as found in games.php (list) and game.php (gameInfo[0]). */
export function mapV2Game(rec: Rec): ParsedGame | null {
	const gameId = id(pick(rec, 'IDgame', 'gid', 'id'));
	if (gameId === null) return null;
	const scheduledDate = cbfDate(rec.gdate);
	const scheduledTime = cbfTime(rec.gtime);
	const [homeScore, awayScore] = scorePair(rec.score_home, rec.score_guest);
	const quarters = parseScoreQuarters(rec.score_quarter);
	return {
		id: gameId,
		phaseId: id(rec.IDphase),
		competitionId: id(rec.IDcompetition),
		round: str(rec.round),
		number: str(rec.num),
		scheduledDate,
		scheduledTime,
		startsAt: pragueToUtc(scheduledDate, scheduledTime),
		home: { id: id(rec.taidteam), name: str(rec.taname), abbr: str(rec.taabbr) },
		away: { id: id(rec.tbidteam), name: str(rec.tbname), abbr: str(rec.tbabbr) },
		homeScore,
		awayScore,
		homePoints: int(rec.points_home),
		awayPoints: int(rec.points_guest),
		quarters: homeScore === null ? quarters.filter((q) => q.home || q.away) : quarters,
		quartersRaw: str(rec.score_quarter),
		venue: parseVenue(rec),
		urlLive: str(rec.url_live),
		videoUrl: str(rec.videoIFrame),
		isTv: bool01(rec.ct4),
		officials: parseV2Officials(rec),
		raw: rec
	};
}

/** games.php?phase= – list of games of a phase. */
export function parseV2Games(body: string): ParsedGame[] {
	return jsonRecords(body).flatMap((rec) => mapV2Game(rec) ?? []);
}

/** game.php?game= – { gameInfo: [ {...} ], …statistics (structure unverified) }. */
export function parseV2GameDetail(body: string): { game: ParsedGame | null; payload: Rec | null } {
	const payload = jsonObject(body);
	if (!payload) return { game: null, payload: null };
	const info =
		asRecordArray(payload.gameInfo)[0] ?? (hasAnyKey(payload, 'IDgame') ? payload : null);
	return { game: info ? mapV2Game(info) : null, payload };
}

/** table.php?phase= – standings. Only `tid` and `cid` are confirmed; the rest is PROVISIONAL. */
export function parseV2Table(body: string): ParsedStanding[] {
	return jsonRecords(body).flatMap((rec) => {
		const teamId = id(pick(rec, 'tid', 'IDteam', 'id'));
		if (teamId === null) return [];
		return [
			{
				teamId,
				competitionId: id(pick(rec, 'cid', 'IDcompetition')),
				teamName: str(pick(rec, 'name', 'tname', 'teamname')),
				teamAbbr: str(pick(rec, 'abbr', 'short_name')),
				position: int(pick(rec, 'pos', 'position', 'rank', 'poradi')),
				gamesPlayed: int(pick(rec, 'gp', 'games', 'played')),
				wins: int(pick(rec, 'gw', 'wins', 'won')),
				losses: int(pick(rec, 'gl', 'losses', 'lost')),
				pointsFor: int(pick(rec, 'sp', 'score_plus', 'pf')),
				pointsAgainst: int(pick(rec, 'sm', 'score_minus', 'pa')),
				points: num(pick(rec, 'pt', 'points', 'pts')),
				raw: rec
			}
		];
	});
}

/** team.php?id=&competition= – { info: [ team ], match: [ … ] }. */
export function parseV2Team(body: string): ParsedTeam | null {
	const payload = jsonObject(body);
	if (!payload) return null;
	const rec = asRecordArray(payload.info)[0];
	if (!rec) return null;
	const teamId = id(pick(rec, 'IDteam', 'id'));
	if (teamId === null) return null;
	const clubId = id(rec.IDclub);
	const isMale = bool01(rec.is_male);
	return {
		id: teamId,
		name: str(rec.name),
		shortName: str(rec.short_name),
		abbr: str(rec.abbr),
		isFemale: isMale === null ? null : !isMale,
		web: str(rec.www),
		email: str(rec.email),
		street: str(rec.street),
		city: str(rec.city),
		zip: str(rec.psc),
		phones: [str(rec.phone_1), str(rec.phone_2)].filter((p): p is string => p !== null),
		categoryId: id(rec.IDcategory),
		club: clubId === null ? null : { id: clubId, name: str(rec.clubname) },
		raw: rec
	};
}

/** teamplayers.php?id=&competition= – PROVISIONAL mapping, structure not verified at all. */
export function parseV2TeamPlayers(body: string): ParsedRosterEntry[] {
	const payload = decodePayload(body);
	if (payload.format !== 'json') return [];
	const data = payload.data;
	const records = isRec(data)
		? asRecordArray(pick(data, 'players', 'player', 'data') ?? data)
		: asRecordArray(data);
	return records.flatMap((rec) => {
		const playerId = id(pick(rec, 'IDplayer', 'IDperson', 'pid', 'id'));
		if (playerId === null) return [];
		return [
			{
				player: {
					id: playerId,
					firstName: str(pick(rec, 'firstname', 'fname', 'name1', 'n1')),
					lastName: str(pick(rec, 'lastname', 'lname', 'surname', 'name2', 'n2')),
					birthYear: int(pick(rec, 'birthyear', 'born', 'year'))
				},
				jersey: str(pick(rec, 'number', 'num', 'jersey', 'dres')),
				raw: rec
			}
		];
	});
}
