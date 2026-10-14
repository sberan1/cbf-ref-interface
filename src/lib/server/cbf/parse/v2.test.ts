// Fixtures are synthetic, modelled on the field names used by public clients; the real export
// structure is verified by `npm run cbf -- discover`.
import { describe, expect, it } from 'vitest';
import {
	parseV2Divs,
	parseV2GameDetail,
	parseV2Games,
	parseV2Phases,
	parseV2SeasonList,
	parseV2Team
} from './v2';

const gameRecord = {
	IDgame: '273093',
	IDphase: '4451',
	IDcompetition: '2097',
	round: '1',
	num: 'A001',
	gdate: '2026-10-03',
	gtime: '18:00:00',
	score_home: '81',
	score_guest: '77',
	points_home: '2',
	points_guest: '1',
	score_quarter: '20:18 15:22 27:20 19:17',
	taidteam: '7046',
	taname: 'BK Domácí',
	taabbr: 'DOM',
	tbidteam: '7047',
	tbname: 'BK Hosté',
	tbabbr: 'HOS',
	place: 'Sportovní hala',
	street: 'Hlavní 1',
	city: 'Nymburk',
	zipcode: '28802',
	lat: '50.18',
	lon: '15.04',
	u1id: '1001',
	u1n1: 'Jan',
	u1n2: 'Novák',
	u2id: '1002',
	u2n1: 'Petr',
	u2n2: 'Svoboda',
	u3id: '0',
	u3n1: '',
	u3n2: '',
	commisarid: '2001',
	commisarn1: 'Eva',
	commisarn2: 'Dvořáková',
	url_live: 'https://example.invalid/live',
	ct4: '0'
};

describe('v2 parsers', () => {
	it('parses competitions', () => {
		const body = JSON.stringify([
			{
				compid: '2097',
				cname: 'Kooperativa NBL',
				catid: '1',
				catname: 'Muži',
				sid: '20',
				female: '0'
			},
			{ cname: 'bez ID' }
		]);
		const [c, ...rest] = parseV2Divs(body);
		expect(rest).toHaveLength(0);
		expect(c).toMatchObject({ id: 2097, name: 'Kooperativa NBL', seasonId: 20, isFemale: false });
		expect(c.category).toMatchObject({ id: 1, name: 'Muži' });
	});

	it('accepts PHP assoc-array JSON and empty bodies', () => {
		expect(parseV2Phases(JSON.stringify({ a: { id: '1', name: 'Základní část' } }))).toHaveLength(
			1
		);
		expect(parseV2Phases('')).toEqual([]);
		expect(parseV2Phases('null')).toEqual([]);
	});

	it('maps a game including officials, venue and quarters', () => {
		const [g] = parseV2Games(JSON.stringify([gameRecord]));
		expect(g).toMatchObject({
			id: 273093,
			phaseId: 4451,
			competitionId: 2097,
			homeScore: 81,
			awayScore: 77,
			startsAt: new Date('2026-10-03T16:00:00.000Z'),
			home: { id: 7046, abbr: 'DOM' },
			venue: { city: 'Nymburk', lat: 50.18 }
		});
		expect(g.quarters).toHaveLength(4);
		expect(g.officials).toEqual([
			{ role: 'referee1', official: { id: 1001, firstName: 'Jan', lastName: 'Novák' } },
			{ role: 'referee2', official: { id: 1002, firstName: 'Petr', lastName: 'Svoboda' } },
			{ role: 'referee3', official: null },
			{ role: 'commissioner', official: { id: 2001, firstName: 'Eva', lastName: 'Dvořáková' } }
		]);
	});

	it('does not report roles that the payload does not carry', () => {
		const partial: Partial<typeof gameRecord> = { ...gameRecord };
		delete partial.u3id;
		delete partial.commisarid;
		const [g] = parseV2Games(JSON.stringify([partial]));
		expect(g.officials.map((o) => o.role)).toEqual(['referee1', 'referee2']);
	});

	it('reads game detail from gameInfo[0]', () => {
		const { game } = parseV2GameDetail(JSON.stringify({ gameInfo: [gameRecord], stats: [] }));
		expect(game?.id).toBe(273093);
	});

	it('parses seasonList in XML', () => {
		const xml = `<?xml version="1.0" encoding="utf-8"?><seasons>
			<season><IDseason>20</IDseason><name>2026/2027</name><short_name>26/27</short_name><current>1</current></season>
			<season><IDseason>19</IDseason><name>2025/2026</name><current>0</current></season></seasons>`;
		expect(parseV2SeasonList(xml)).toMatchObject([
			{ id: 20, startYear: 2026, isCurrent: true },
			{ id: 19, startYear: 2025, isCurrent: false }
		]);
	});

	it('parses team info', () => {
		const body = JSON.stringify({
			info: [
				{
					IDteam: '7046',
					name: 'BK Domácí',
					is_male: '1',
					IDclub: '55',
					clubname: 'BK',
					phone_1: '123'
				}
			],
			match: []
		});
		expect(parseV2Team(body)).toMatchObject({
			id: 7046,
			isFemale: false,
			club: { id: 55 },
			phones: ['123']
		});
	});
});
