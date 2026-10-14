// Fixtures follow the structure of live v1 samples (discovery 2026-10-14); people are made up.
import { describe, expect, it } from 'vitest';
import { decodeBody } from '../http';
import { parseV1Divs, parseV1Sched, parseV1Table } from './v1';

const sched = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE games PUBLIC "-//CBF//divisions list//EN" "http://www.cbf.cz/xml/spec/sched.dtd">
<games>
<game>
  <id>544546</id><xround></xround><round>1</round><div>5402</div><num>1</num><gdate>2026-09-20</gdate><gtime>18:00:00</gtime>
  <place>Sportcentrum SLUNETA</place> <city>Ústí nad Labem</city>
  <ref ord="1"><id>2001</id><lastname>Novák</lastname><firstname>Jan</firstname></ref>
  <ref ord="2"><id>50011</id><lastname>Svoboda</lastname><firstname>Petr</firstname></ref>
  <ref ord="3"><id>2003</id><lastname>Dvořák</lastname><firstname>Karel</firstname></ref>
  <sup><id>3001</id><lastname>Dvořáková</lastname><firstname>Eva</firstname></sup>
  <team guest="0"><id>9</id><name>SLUNETA  Ústí nad Labem</name><abbr>SLUNETA Ústí nad Labem</abbr></team>
  <team guest="1"><id>421</id><name>Sršni Photomate Písek</name><abbr>Sršni Photomate Písek</abbr></team>
  <result>
    <pts><a>1</a><b>2</b></pts><score><a>78</a><b>80</b></score>
    <partials><partial ord="1"><a>13</a><b>8</b></partial><partial ord="2"><a>32</a><b>26</b></partial><partial ord="3"><a>58</a><b>48</b></partial></partials>
    <urllive>https://example.invalid/live</urllive>
  </result>
</game>
<game>
  <id>544582</id><xround></xround><round>7</round><div>5402</div><num>37</num><gdate>2026-10-17</gdate><gtime>19:00:00</gtime>
  <place>Víceúčelová hala Opava</place> <city>Opava</city>
  <sup><id>3002</id><lastname>Kopecký</lastname><firstname>Josef</firstname></sup>
  <team guest="0"><id>7</id><name>BK Opava</name></team>
  <team guest="1"><id>421</id><name>Sršni Photomate Písek</name></team>
  <result>
    <pts><a>0</a><b>0</b></pts><score><a>0</a><b>0</b></score>
    <partials><partial ord="1"><a>0</a><b>0</b></partial></partials>
  </result>
</game>
</games>`;

describe('v1 parsers', () => {
	it('parses games without v2 team IDs and converts cumulative partials', () => {
		const { games } = parseV1Sched(sched, 10310);
		const [played, upcoming] = games;
		expect(played).toMatchObject({
			id: 544546,
			phaseId: 10310,
			competitionId: 5402,
			homeScore: 78,
			awayScore: 80,
			homePoints: 1,
			home: { id: null, groupId: 9, name: 'SLUNETA  Ústí nad Labem' },
			away: { id: null, groupId: 421 },
			officials: []
		});
		expect(played.quarters.map((q) => [q.home, q.away])).toEqual([
			[13, 8],
			[19, 18],
			[26, 22],
			[20, 32]
		]);
		expect(upcoming).toMatchObject({ homeScore: null, homePoints: null, quarters: [] });
	});

	it('returns delegations by canonical person ID, using the ord attribute', () => {
		const { officials } = parseV1Sched(sched, 10310);
		expect(officials.map((o) => [o.gameId, o.role, o.groupId])).toEqual([
			[544546, 'referee1', 2001],
			[544546, 'referee2', 50011],
			[544546, 'referee3', 2003],
			[544546, 'commissioner', 3001],
			[544582, 'commissioner', 3002]
		]);
	});

	it('parses competitions with category, league, flags and phases', () => {
		const xml = `<divs><div>
			<id>5373</id><name>Středomoravská liga mužů</name>
			<season><id>2026</id><name>2026/27</name></season>
			<cat><id>1634</id><name>muži</name></cat>
			<league><id>2832</id><name>Oblasti</name></league>
			<flags><flag name="public" /><flag name="refeval" /></flags>
			<phases>
				<phase><id>10205</id><name>Základní část</name><type>1</type><offset>0</offset></phase>
				<phase><id>10288</id><name>Play Off</name><type>2</type></phase>
			</phases></div>
			<div><id>5370</id><name>Bez fází</name><flags><flag name="results" /></flags><phases></phases></div></divs>`;
		const [withPhases, empty] = parseV1Divs(xml);
		expect(withPhases).toMatchObject({
			id: 5373,
			category: { id: 1634, name: 'muži' },
			league: { id: 2832, name: 'Oblasti' },
			phases: [
				{ id: 10205, typeId: 1 },
				{ id: 10288, typeId: 2 }
			]
		});
		expect(withPhases.flags).toMatchObject({ public: true, refeval: true, finished: false });
		expect(empty.phases).toEqual([]);
		expect(empty.flags.results).toBe(true);
	});

	it('keeps NBL win percentage in standings points', () => {
		const xml = `<table><team><pos>1</pos><id>14787</id><name>BK</name><gp>6</gp><gw>6</gw><gl>0</gl>
			<sp>604</sp><sm>454</sm><pt>100.0</pt><group>13466</group></team></table>`;
		expect(parseV1Table(xml)).toMatchObject([
			{ teamId: 14787, teamGroupId: 13466, position: 1, points: 100 }
		]);
	});

	it('decodes windows-1250 XML by its declaration', () => {
		const head = '<?xml version="1.0" encoding="windows-1250"?><divs><div><id>1</id><name>';
		const tail = '</name></div></divs>';
		// "Přebor" in cp1250: ř = 0xF8
		const bytes = new Uint8Array([
			...new TextEncoder().encode(head),
			0x50,
			0xf8,
			0x65,
			0x62,
			0x6f,
			0x72,
			...new TextEncoder().encode(tail)
		]);
		expect(parseV1Divs(decodeBody(bytes, 'text/xml'))[0].name).toBe('Přebor');
	});
});
