/**
 * Parsers for the documented v1 XML export (https://cbf.cz/xml/), verified against live samples
 * (discovery 2026-10-14). Used as a supplementary source (ADR 0005).
 *
 * v1 shares IDs of competitions, phases and games with v2, but identifies people and teams in
 * sched.php by their canonical "group" IDs (v2 `uNgroup` / `groupby`), not by v2 IDs.
 */
import {
	cbfDate,
	cbfTime,
	id,
	int,
	isRec,
	num,
	periodsFromCumulative,
	pragueToUtc,
	scorePair,
	str,
	type Rec,
	type ScorePair
} from './coerce';
import { CbfParseError, decodePayload, xmlList, xmlRoot } from './payload';
import type {
	IdName,
	ParsedGame,
	ParsedStanding,
	ParsedTeamRef,
	ParsedV1Competition,
	V1OfficialRef
} from './types';

export const v1CompetitionFlags = [
	'public',
	'finished',
	'players',
	'results',
	'stats',
	'events',
	'refeval',
	'clubeval',
	'gplayers',
	'sups'
] as const;

function root(body: string): Rec | null {
	const payload = decodePayload(body);
	if (payload.format === 'empty') return null;
	if (payload.format !== 'xml') throw new CbfParseError(`Expected XML, got ${payload.format}`);
	return xmlRoot(payload.data);
}

function idName(value: unknown): IdName | null {
	if (!isRec(value)) return null;
	const valueId = id(value.id);
	return valueId === null ? null : { id: valueId, name: str(value.name) };
}

/** <flags><flag name="results" />…</flags>: listed flags are set, all other known flags are not. */
function readFlags(div: Rec): Record<string, boolean | null> {
	const present = new Set(
		xmlList(isRec(div.flags) ? div.flags.flag : undefined).map((f) => str(f['@_name']))
	);
	return Object.fromEntries(v1CompetitionFlags.map((flag) => [flag, present.has(flag)]));
}

/**
 * divs.php?s=ROK – every competition of the season in one document: <div><id/><name/>
 * <season/><cat/><league/><flags/><phases><phase><id/><name/><type/></phase></phases></div>.
 */
export function parseV1Divs(body: string): ParsedV1Competition[] {
	const r = root(body);
	if (!r) return [];
	return xmlList(r.div).flatMap((div) => {
		const compId = id(div.id);
		if (compId === null) return [];
		const phases = xmlList(isRec(div.phases) ? div.phases.phase : undefined).flatMap((p) => {
			const phaseId = id(p.id);
			return phaseId === null ? [] : [{ id: phaseId, name: str(p.name), typeId: id(p.type) }];
		});
		return [
			{
				id: compId,
				name: str(div.name),
				category: idName(div.cat),
				league: idName(div.league),
				flags: readFlags(div),
				phases,
				raw: div
			}
		];
	});
}

function teamRef(rec: Rec | undefined): ParsedTeamRef {
	// v1 team <id> is the team group ID, never a v2 team ID
	if (!rec) return { id: null, groupId: null, name: null, abbr: null };
	return { id: null, groupId: id(rec.id), name: str(rec.name), abbr: null };
}

const refRoles = ['referee1', 'referee2', 'referee3'] as const;

export interface ParsedV1Sched {
	/** Games without team IDs and officials (those are in a different ID space). */
	games: ParsedGame[];
	/** Delegations by canonical person ID, used to link v1 and v2 people. */
	officials: V1OfficialRef[];
}

/** sched.php?p=FÁZE – schedule, results, cumulative partials and delegations (<ref ord>, <sup>). */
export function parseV1Sched(body: string, phaseId: number | null): ParsedV1Sched {
	const r = root(body);
	if (!r) return { games: [], officials: [] };
	const officials: V1OfficialRef[] = [];
	const games = xmlList(r.game).flatMap((g): ParsedGame[] => {
		const gameId = id(g.id);
		if (gameId === null) return [];
		const teams = xmlList(g.team);
		const home = teams.find((t) => str(t['@_guest']) === '0') ?? teams[0];
		const away = teams.find((t) => str(t['@_guest']) === '1') ?? teams[1];
		const result = isRec(g.result) ? g.result : {};
		const score = isRec(result.score) ? result.score : {};
		const pts = isRec(result.pts) ? result.pts : {};
		const [homeScore, awayScore] = scorePair(score.a, score.b);
		const scheduledDate = cbfDate(g.gdate);
		const scheduledTime = cbfTime(g.gtime);

		const partials = xmlList(isRec(result.partials) ? result.partials.partial : undefined)
			.map((p) => ({ ord: int(p['@_ord']) ?? 0, a: int(p.a), b: int(p.b) }))
			.sort((x, y) => x.ord - y.ord)
			.flatMap((p): ScorePair[] => (p.a === null || p.b === null ? [] : [[p.a, p.b]]));

		for (const [i, ref] of xmlList(g.ref).entries()) {
			const role = refRoles[(int(ref['@_ord']) ?? i + 1) - 1];
			const groupId = id(ref.id);
			if (!role || groupId === null) continue;
			officials.push({
				gameId,
				role,
				groupId,
				firstName: str(ref.firstname),
				lastName: str(ref.lastname)
			});
		}
		const sup = xmlList(g.sup)[0];
		const supId = sup ? id(sup.id) : null;
		if (sup && supId !== null) {
			officials.push({
				gameId,
				role: 'commissioner',
				groupId: supId,
				firstName: str(sup.firstname),
				lastName: str(sup.lastname)
			});
		}

		return [
			{
				id: gameId,
				phaseId,
				// <div> is parsed as an array because it is a repeated element in divs.php
				competitionId: id(Array.isArray(g.div) ? g.div[0] : g.div),
				round: str(g.round),
				number: str(g.num),
				scheduledDate,
				scheduledTime,
				startsAt: pragueToUtc(scheduledDate, scheduledTime),
				home: teamRef(home),
				away: teamRef(away),
				homeScore,
				awayScore,
				homePoints: homeScore === null ? null : int(pts.a),
				awayPoints: homeScore === null ? null : int(pts.b),
				quarters:
					homeScore !== null && partials.length >= 3
						? periodsFromCumulative(partials, [homeScore, awayScore])
						: [],
				quartersRaw: null,
				venue:
					str(g.place) || str(g.city)
						? {
								hallId: null,
								name: str(g.place),
								street: null,
								city: str(g.city),
								zip: null,
								lat: null,
								lon: null
							}
						: null,
				urlLive: str(result.urllive),
				videoUrl: null,
				isTv: null,
				resultChecked: null,
				attendance: null,
				officials: [],
				raw: g
			}
		];
	});
	return { games, officials };
}

/** table.php?p=FÁZE – <team><pos/><id/><name/><abbr/><gp/><gw/><gl/><sp/><sm/><pt/><group/></team>. */
export function parseV1Table(body: string): ParsedStanding[] {
	const r = root(body);
	if (!r) return [];
	return xmlList(r.team).flatMap((t) => {
		const teamId = id(t.id);
		if (teamId === null) return [];
		return [
			{
				teamId,
				teamGroupId: id(t.group),
				competitionId: null,
				teamName: str(t.name),
				teamAbbr: str(t.abbr),
				position: int(t.pos),
				gamesPlayed: int(t.gp),
				wins: int(t.gw),
				losses: int(t.gl),
				pointsFor: int(t.sp),
				pointsAgainst: int(t.sm),
				points: num(t.pt),
				raw: t
			}
		];
	});
}
