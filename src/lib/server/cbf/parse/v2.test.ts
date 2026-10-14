// Fixtures follow the structure of live samples (discovery 2026-10-14); IDs and names of people
// are made up.
import { describe, expect, it } from 'vitest';
import {
	parseV2Divs,
	parseV2GameDetail,
	parseV2Games,
	parseV2Phases,
	parseV2SeasonList,
	parseV2Table,
	parseV2Team,
	parseV2TeamPlayers
} from './v2';

/** games.php record: carries the commissioner, but no referees. */
const listRecord = {
	time_of_action: '2026-09-20 18:00:00',
	IDgame: '544546',
	IDphase: '10310',
	IDunderPhase: null,
	round: '1',
	num: '1',
	IDcompetition: '5402',
	gdate: '2026-09-20',
	gtime: '18:00:00',
	points_home: '1',
	points_guest: '2',
	score_home: '78',
	score_guest: '80',
	score_quarter: '13:8 32:26 58:48',
	url_live: 'https://example.invalid/live',
	embed_url: 'https://example.invalid/embed',
	ct4: '0',
	tagroupby: '9',
	taidteam: '7001',
	taname: 'SLUNETA  Ústí nad Labem',
	taabbr: 'SLUNETA Ústí nad Labem',
	tbgroupby: '421',
	tbidteam: '10110',
	tbname: 'Sršni Photomate Písek',
	tbabbr: 'Sršni Photomate Písek',
	ateams2: 'UNL',
	bteams2: 'PIS',
	commisarid: '50001',
	commisarn1: 'Eva',
	commisarn2: 'Dvořáková',
	place: 'Sportcentrum SLUNETA',
	city: 'Ústí nad Labem',
	lat: '50.66531830',
	lon: '14.01285350'
};

/** game.php gameInfo record: the list fields plus referees, hall and street. */
const detailRecord = {
	...listRecord,
	checked: '1',
	num_visitors: '1107',
	IDhall: '245',
	street: 'Jateční 18',
	zipcode: '40001',
	u1id: '50010',
	u1n1: 'Jan',
	u1n2: 'Novák',
	u1group: '2001',
	u2id: '50011',
	u2n1: 'Petr',
	u2n2: 'Svoboda',
	u2group: '50011',
	u3id: '0',
	u3n1: '',
	u3n2: '',
	u3group: '0',
	rating_u1_home: '8',
	rating_u1_guest: null,
	rating_u1_commisar: null,
	rating_u2_home: null,
	rating_u2_guest: null,
	rating_u2_commisar: null
};

describe('v2 parsers', () => {
	it('parses competitions with area and league', () => {
		const body = JSON.stringify([
			{
				compid: '5402',
				cname: 'Maxa NBL',
				catid: '1634',
				catname: 'muži',
				cgid: '2833',
				cgname: 'NBL',
				sid: '36',
				sname: '2026/27',
				season_short_name: '2026',
				female: '0',
				area: '0'
			},
			{ cname: 'bez ID' }
		]);
		const [c, ...rest] = parseV2Divs(body);
		expect(rest).toHaveLength(0);
		expect(c).toMatchObject({
			id: 5402,
			seasonId: 36,
			areaId: 0,
			isFemale: false,
			category: { id: 1634, name: 'muži' },
			league: { id: 2833, name: 'NBL' }
		});
	});

	it('accepts PHP assoc-array JSON and empty bodies', () => {
		expect(
			parseV2Phases(JSON.stringify({ a: { id: '10310', name: 'Základní část' } }))
		).toHaveLength(1);
		expect(parseV2Phases('')).toEqual([]);
		expect(parseV2Phases('[]')).toEqual([]);
	});

	it('maps a games.php record: commissioner only, cumulative quarters, short codes', () => {
		const [g] = parseV2Games(JSON.stringify([listRecord]));
		expect(g).toMatchObject({
			id: 544546,
			phaseId: 10310,
			competitionId: 5402,
			homeScore: 78,
			awayScore: 80,
			startsAt: new Date('2026-09-20T16:00:00.000Z'),
			home: { id: 7001, groupId: 9, abbr: 'UNL' },
			away: { id: 10110, groupId: 421, abbr: 'PIS' },
			venue: { hallId: null, name: 'Sportcentrum SLUNETA', lat: 50.6653183 }
		});
		expect(g.quarters.map((q) => [q.home, q.away])).toEqual([
			[13, 8],
			[19, 18],
			[26, 22],
			[20, 32]
		]);
		expect(g.officials).toEqual([
			{
				role: 'commissioner',
				official: {
					id: 50001,
					groupId: null,
					firstName: 'Eva',
					lastName: 'Dvořáková'
				}
			}
		]);
	});

	it('maps game.php with referees, vacancy and box score', () => {
		const detail = parseV2GameDetail(
			JSON.stringify({
				gameInfo: [detailRecord],
				playerStats: [
					{
						IDuser: '143628',
						groupby: '143628',
						first_name: 'Adam',
						last_name: 'Hráč',
						IDteam: '7001',
						number: '7',
						GUEST: '0',
						PTS: '16'
					}
				],
				teamStats: [{ IDteam: '7001', groupby: '9', GUEST: '0', PTS_P: '78' }]
			})
		);
		expect(detail.game).toMatchObject({
			resultChecked: true,
			attendance: 1107,
			venue: { hallId: 245, street: 'Jateční 18' }
		});
		expect(
			detail.game?.officials.map((o) => [o.role, o.official?.id, o.official?.groupId])
		).toEqual([
			['referee1', 50010, 2001],
			['referee2', 50011, 50011],
			['referee3', undefined, undefined],
			['commissioner', 50001, null]
		]);
		expect(detail.players).toMatchObject([
			{ player: { id: 143628, groupId: 143628 }, teamId: 7001, jersey: '7', isGuest: false }
		]);
		expect(detail.teams).toMatchObject([{ teamId: 7001, groupId: 9, isGuest: false }]);
	});

	it('treats a hidden delegation ("Delegováno", ID 0) as unknown, not vacant', () => {
		const hidden = {
			...detailRecord,
			score_home: null,
			score_guest: null,
			score_quarter: null,
			u1id: '0',
			u1n1: '',
			u1n2: 'Delegováno',
			u2id: '0',
			u2n1: '',
			u2n2: 'Delegováno'
		};
		const { game } = parseV2GameDetail(JSON.stringify({ gameInfo: [hidden] }));
		expect(game?.homeScore).toBeNull();
		expect(game?.quarters).toEqual([]);
		expect(game?.officials.map((o) => [o.role, o.official?.id ?? null])).toEqual([
			['referee3', null],
			['commissioner', 50001]
		]);
	});

	it('parses seasonList in XML and JSON', () => {
		const xml = `<?xml version="1.0" encoding="utf-8"?><seasons>
			<season><IDseason>36</IDseason><name>2026/27</name><short_name>2026</short_name>
				<date_of_begin>2026-05-01</date_of_begin><date_of_end>2027-05-31</date_of_end><current>1</current></season>
			<season><IDseason>1</IDseason><name>1992/93</name><short_name>1992</short_name><current>0</current></season></seasons>`;
		expect(parseV2SeasonList(xml)).toMatchObject([
			{ id: 36, startYear: 2026, beginsOn: '2026-05-01', endsOn: '2027-05-31', isCurrent: true },
			{ id: 1, startYear: 1992, isCurrent: false }
		]);
		const json = JSON.stringify([{ IDseason: '22', name: '2012/13', short_name: '2012' }]);
		expect(parseV2SeasonList(json)).toMatchObject([{ id: 22, startYear: 2012 }]);
	});

	it('parses standings', () => {
		const body = JSON.stringify([
			{
				tid: '14787',
				cid: '5402',
				tname: 'SK Slavia Praha',
				abbr: 'SK Slavia Praha',
				gr: '13466',
				countmatch: '6',
				countwin: '6',
				countloose: '0',
				sumscore1: '604',
				sumscore2: '454',
				sumpoints: '100.0',
				position: 1,
				group: 13466
			}
		]);
		expect(parseV2Table(body)).toMatchObject([
			{
				teamId: 14787,
				teamGroupId: 13466,
				position: 1,
				gamesPlayed: 6,
				wins: 6,
				losses: 0,
				pointsFor: 604,
				pointsAgainst: 454,
				points: 100
			}
		]);
	});

	it('parses team info with club contacts', () => {
		const body = JSON.stringify({
			info: [
				{
					IDteam: '7001',
					name: 'SLUNETA  Ústí nad Labem',
					short_name2: 'UNL',
					is_male: '1',
					groupby: '9',
					IDclub: '1490',
					clubname: 'BK',
					phone_1: '123',
					phone_2: ''
				}
			],
			contact: [
				{
					IDuser: '58001',
					groupby: '123',
					first_name: 'Karel',
					last_name: 'Vzorový',
					birthdate: '1980-01-01',
					name: 'organizační pracovník',
					phone_1: '',
					phone_3: '777 000 000',
					date_of_begin: '2013-08-20',
					date_of_end: null
				}
			],
			match: []
		});
		expect(parseV2Team(body)).toMatchObject({
			id: 7001,
			groupId: 9,
			abbr: 'UNL',
			isFemale: false,
			club: { id: 1490 },
			phones: ['123'],
			contacts: [
				{
					userId: 58001,
					groupId: 123,
					role: 'organizační pracovník',
					birthDate: '1980-01-01',
					phones: ['777 000 000'],
					validFrom: '2013-08-20',
					validTo: null
				}
			]
		});
	});

	it('parses the roster from playerstatcount', () => {
		const body = JSON.stringify({
			info: [{ IDteam: '7001' }],
			playerstatcount: [
				{
					IDplayer: '109430',
					groupby: '109430',
					first_name: 'Adam',
					last_name: 'Hráč',
					height: '190',
					num_of_dress: '7',
					PTS: '0'
				}
			],
			ztotal: [{ sXGP: '6' }]
		});
		expect(parseV2TeamPlayers(body)).toMatchObject([
			{ player: { id: 109430, groupId: 109430, height: 190 }, jersey: '7' }
		]);
	});
});
