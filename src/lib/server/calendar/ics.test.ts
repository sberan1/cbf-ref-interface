import { describe, expect, it } from 'vitest';
import { escapeText, foldLine, formatUtc, renderCalendar } from './ics';

describe('ics', () => {
	it('escapes text values', () => {
		expect(escapeText('Hala; Praha, 3\\x\nřádek')).toBe('Hala\\; Praha\\, 3\\\\x\\nřádek');
	});

	it('folds long lines at 75 octets without splitting characters', () => {
		const line = `DESCRIPTION:${'ž'.repeat(60)}`;
		const folded = foldLine(line);
		const parts = folded.split('\r\n');
		expect(parts.length).toBeGreaterThan(1);
		for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
		expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
		expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
		expect(foldLine('SUMMARY:krátké')).toBe('SUMMARY:krátké');
	});

	it('formats UTC instants', () => {
		expect(formatUtc(new Date('2026-10-24T08:30:00.000Z'))).toBe('20261024T083000Z');
	});

	it('renders timed and all-day events with CRLF line ends', () => {
		const ics = renderCalendar({
			name: 'Rozhodčí ČBF – Beran',
			now: new Date('2026-10-27T12:00:00Z'),
			events: [
				{
					uid: 'game-1-referee1@x',
					start: new Date('2026-10-24T08:30:00Z'),
					end: new Date('2026-10-24T10:30:00Z'),
					summary: 'A – B',
					location: 'Hala, Praha',
					geo: { lat: 50.08, lon: 14.45 },
					description: 'řádek 1\nřádek 2',
					url: 'https://example.org/live'
				},
				{ uid: 'own-1@x', date: '2026-12-31', summary: 'Silvestrovský turnaj' }
			]
		});
		expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
		expect(ics).toContain('X-WR-CALNAME:Rozhodčí ČBF – Beran\r\n');
		expect(ics).toContain('DTSTAMP:20261027T120000Z\r\n');
		expect(ics).toContain('DTSTART:20261024T083000Z\r\nDTEND:20261024T103000Z\r\n');
		expect(ics).toContain('LOCATION:Hala\\, Praha\r\n');
		expect(ics).toContain('GEO:50.08;14.45\r\n');
		expect(ics).toContain('DESCRIPTION:řádek 1\\nřádek 2\r\n');
		expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n');
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
	});
});
