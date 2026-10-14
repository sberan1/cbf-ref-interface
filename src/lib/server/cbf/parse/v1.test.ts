// Synthetic fixtures following the element names read by ivosu/cbf_ical.
import { describe, expect, it } from 'vitest';
import { decodeBody } from '../http';
import { parseV1Divs, parseV1Sched, parseV1Table } from './v1';

const sched = `<?xml version="1.0" encoding="utf-8"?>
<schedule>
	<game>
		<id>273093</id><gdate>2026-10-03</gdate><gtime>18:00:00</gtime>
		<place>Sportovní hala</place><city>Nymburk</city>
		<ref><id>1001</id><firstname>Jan</firstname><lastname>Novák</lastname></ref>
		<ref><id>1002</id><firstname>Petr</firstname><lastname>Svoboda</lastname></ref>
		<sup><id>2001</id><firstname>Eva</firstname><lastname>Dvořáková</lastname></sup>
		<team guest="0"><id>7046</id><name>BK Domácí</name><abbr>DOM</abbr></team>
		<team guest="1"><id>7047</id><name>BK Hosté</name><abbr>HOS</abbr></team>
		<result>
			<pts><a>2</a><b>1</b></pts>
			<score><a>81</a><b>77</b></score>
			<partials><partial ord="1"><a>20</a><b>18</b></partial><partial ord="2"><a>15</a><b>22</b></partial></partials>
			<urllive>https://example.invalid/live</urllive>
		</result>
	</game>
	<game>
		<id>273094</id><gdate>0000-00-00</gdate><gtime>00:00:00</gtime>
		<team guest="0"><id>7047</id><name>BK Hosté</name></team>
		<team guest="1"><id>7046</id><name>BK Domácí</name></team>
		<result><score><a>0</a><b>0</b></score></result>
	</game>
</schedule>`;

describe('v1 parsers', () => {
	it('parses a schedule with delegations and partials', () => {
		const [played, unscheduled] = parseV1Sched(sched, 4451);
		expect(played).toMatchObject({
			id: 273093,
			phaseId: 4451,
			homeScore: 81,
			awayScore: 77,
			homePoints: 2,
			home: { id: 7046, abbr: 'DOM' },
			away: { id: 7047 },
			urlLive: 'https://example.invalid/live'
		});
		expect(played.quarters).toEqual([
			{ period: 1, home: 20, away: 18 },
			{ period: 2, home: 15, away: 22 }
		]);
		expect(played.officials.map((o) => [o.role, o.official?.id])).toEqual([
			['referee1', 1001],
			['referee2', 1002],
			['commissioner', 2001]
		]);
		expect(unscheduled).toMatchObject({
			scheduledDate: null,
			startsAt: null,
			homeScore: null,
			officials: []
		});
	});

	it('parses competitions with phases and flags', () => {
		const xml = `<divs><div refeval="1"><id>2097</id><name>NBL</name><finished>0</finished>
			<phases><phase><id>4451</id><name>Základní část</name></phase></phases></div></divs>`;
		expect(parseV1Divs(xml)).toMatchObject([
			{
				id: 2097,
				name: 'NBL',
				flags: { finished: false, refeval: true },
				phases: [{ id: 4451, name: 'Základní část' }]
			}
		]);
	});

	it('keeps NBL win percentage in standings points', () => {
		const xml = `<table><team><pos>1</pos><id>7046</id><name>BK</name><gp>10</gp><gw>9</gw><gl>1</gl>
			<sp>900</sp><sm>700</sm><pt>0.9</pt></team></table>`;
		expect(parseV1Table(xml)).toMatchObject([{ teamId: 7046, position: 1, points: 0.9 }]);
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
