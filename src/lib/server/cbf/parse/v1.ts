/**
 * Parsers for the documented v1 XML export (https://www.cbf.cz/xml/), structure taken from
 * ivosu/cbf_ical. Used as a supplementary source (ADR 0005).
 */
import {
	bool01,
	cbfDate,
	cbfTime,
	id,
	int,
	isRec,
	num,
	pragueToUtc,
	scorePair,
	str,
	type Rec
} from './coerce';
import { CbfParseError, decodePayload, xmlList, xmlRoot } from './payload';
import type {
	ObservedOfficial,
	ParsedGame,
	ParsedStanding,
	ParsedTeamRef,
	ParsedV1Competition
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

/** Flag may be a child element or an attribute; keep whatever is present. */
function readFlags(rec: Rec): Record<string, boolean | null> {
	const flags: Record<string, boolean | null> = {};
	const source = isRec(rec.flags) ? rec.flags : rec;
	for (const flag of v1CompetitionFlags) {
		const value = source[flag] ?? source[`@_${flag}`];
		if (value !== undefined) flags[flag] = bool01(value);
	}
	return flags;
}

/** divs.php?s=ROK – <div><id/><name/><phases><phase><id/><name/></phase></phases></div>. */
export function parseV1Divs(body: string): ParsedV1Competition[] {
	const r = root(body);
	if (!r) return [];
	return xmlList(r.div).flatMap((div) => {
		const compId = id(div.id ?? div['@_id']);
		if (compId === null) return [];
		const phases = xmlList(isRec(div.phases) ? div.phases.phase : undefined).flatMap((p) => {
			const phaseId = id(p.id ?? p['@_id']);
			return phaseId === null ? [] : [{ id: phaseId, name: str(p.name) }];
		});
		return [{ id: compId, name: str(div.name), flags: readFlags(div), phases, raw: div }];
	});
}

function parseRef(rec: Rec) {
	const personId = id(rec.id);
	if (personId === null) return null;
	return { id: personId, firstName: str(rec.firstname), lastName: str(rec.lastname) };
}

function teamRef(rec: Rec | undefined): ParsedTeamRef {
	if (!rec) return { id: null, name: null, abbr: null };
	return { id: id(rec.id), name: str(rec.name), abbr: str(rec.abbr) };
}

/** sched.php?p=FÁZE – schedule, results, quarters and delegations (<ref>, <sup>). */
export function parseV1Sched(body: string, phaseId: number | null): ParsedGame[] {
	const r = root(body);
	if (!r) return [];
	return xmlList(r.game).flatMap((g) => {
		const gameId = id(g.id ?? g['@_id']);
		if (gameId === null) return [];
		const teams = xmlList(g.team);
		const home = teams.find((t) => str(t['@_guest']) === '0') ?? teams[0];
		const away = teams.find((t) => str(t['@_guest']) === '1') ?? teams[1];
		const result = isRec(g.result) ? g.result : {};
		const score = isRec(result.score) ? result.score : {};
		const pts = isRec(result.pts) ? result.pts : {};
		const partials = xmlList(isRec(result.partials) ? result.partials.partial : undefined);
		const [homeScore, awayScore] = scorePair(score.a, score.b);
		const scheduledDate = cbfDate(g.gdate);
		const scheduledTime = cbfTime(g.gtime);

		const officials: ObservedOfficial[] = xmlList(g.ref)
			.slice(0, 3)
			.map((ref, i) => ({
				role: (['referee1', 'referee2', 'referee3'] as const)[i],
				official: parseRef(ref)
			}))
			.filter((o) => o.official !== null);
		const sup = xmlList(g.sup)[0];
		const supervisor = sup ? parseRef(sup) : null;
		if (supervisor) officials.push({ role: 'commissioner', official: supervisor });

		const quarters = partials
			.map((p, i) => ({
				period: int(p['@_ord']) ?? i + 1,
				home: int(p.a),
				away: int(p.b)
			}))
			.filter((q) => homeScore !== null || q.home || q.away);

		return [
			{
				id: gameId,
				phaseId,
				competitionId: null,
				round: str(g.round),
				number: str(g.num),
				scheduledDate,
				scheduledTime,
				startsAt: pragueToUtc(scheduledDate, scheduledTime),
				home: teamRef(home),
				away: teamRef(away),
				homeScore,
				awayScore,
				homePoints: int(pts.a),
				awayPoints: int(pts.b),
				quarters,
				quartersRaw: null,
				venue:
					str(g.place) || str(g.city)
						? {
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
				officials,
				raw: g
			}
		];
	});
}

/** table.php?p=FÁZE – <team><pos/><id/><name/><abbr/><gp/><gw/><gl/><sp/><sm/><pt/></team>. */
export function parseV1Table(body: string): ParsedStanding[] {
	const r = root(body);
	if (!r) return [];
	return xmlList(r.team).flatMap((t) => {
		const teamId = id(t.id);
		if (teamId === null) return [];
		return [
			{
				teamId,
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
