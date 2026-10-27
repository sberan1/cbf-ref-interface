import { describe, expect, it } from 'vitest';
import { formatKc } from '../../format';
import type { GameFee } from '../fees';
import type { OwnGame } from '../referee/own-games';
import { calendarEvents, gameEvent, ownGameEvent, type CalendarGame } from './feed';

const base: CalendarGame = {
	id: 544582,
	role: 'referee2',
	startsAt: new Date('2026-10-17T17:00:00Z'),
	scheduledDate: '2026-10-17',
	competition: 'nadregionální liga U17M',
	category: 'muži U17',
	phase: 'Základní část',
	round: '7',
	number: '37',
	homeTeam: 'BK Opava',
	awayTeam: 'Sršni Photomate Písek',
	homeScore: 78,
	awayScore: 80,
	venue: {
		name: 'Víceúčelová hala Opava',
		street: 'Žižkova 2904/8',
		zip: '746 01',
		city: 'Opava',
		lat: 49.9493167,
		lon: 17.8835144
	},
	urlLive: 'https://www.fibalivestats.com/webcast/CBFFE/2910248/',
	videoUrl: 'https://embed.tvcom.cz/x/',
	tv: ['ČT sport'],
	officials: [
		{ role: 'referee1', name: 'Jan Novák' },
		{ role: 'referee2', name: 'Testovací Rozhodčí' },
		{ role: 'commissioner', name: 'Antonín Kapl' }
	],
	quarters: [
		{ period: 1, home: 13, away: 8 },
		{ period: 2, home: 19, away: 18 },
		{ period: 3, home: 26, away: 22 },
		{ period: 4, home: 12, away: 24 },
		{ period: 5, home: 8, away: 8 }
	]
};

const fee: GameFee = {
	amount: 600,
	key: 'praha.preborA',
	label: 'Přebor A',
	scheduleId: 'praha-2026',
	provenance: 'assumed',
	note: null,
	singleReferee: false
} as GameFee;

describe('gameEvent', () => {
	it('carries everything about the game', () => {
		const e = gameEvent(base, fee, 'https://app.example')!;
		expect(e.uid).toBe('game-544582-referee2@cbf-ref-interface');
		expect(e.summary).toBe('BK Opava – Sršni Photomate Písek · nadregionální liga U17M');
		expect(e.start?.toISOString()).toBe('2026-10-17T17:00:00.000Z');
		expect(e.end?.toISOString()).toBe('2026-10-17T19:00:00.000Z');
		expect(e.location).toBe('Víceúčelová hala Opava, Žižkova 2904/8, 746 01 Opava');
		expect(e.geo).toEqual({ lat: 49.9493167, lon: 17.8835144 });
		expect(e.url).toBe(base.urlLive);
		expect(e.description).toBe(
			[
				'Soutěž: nadregionální liga U17M · muži U17',
				'Základní část, 7. kolo, utkání č. 37',
				'Moje role: 2. rozhodčí',
				'',
				'1. rozhodčí: Jan Novák',
				'2. rozhodčí: Testovací Rozhodčí',
				'Komisař: Antonín Kapl',
				'',
				'Hala: Víceúčelová hala Opava, Žižkova 2904/8, 746 01 Opava',
				'',
				`Odměna: ≈ ${formatKc(600)} (Přebor A)`,
				'Výsledek: 78:80 (13:8, 19:18, 26:22, 12:24, prodl. 8:8)',
				'',
				'Televize: ČT sport',
				'Video: https://embed.tvcom.cz/x/',
				'Live statistiky: https://www.fibalivestats.com/webcast/CBFFE/2910248/',
				'Vyúčtování: https://app.example/payouts?m=2026-10'
			].join('\n')
		);
	});

	it('shows why a fee is missing, skips an unknown result and marks the commissioner', () => {
		const e = gameEvent(
			{
				...base,
				role: 'commissioner',
				homeScore: null,
				awayScore: null,
				quarters: [],
				tv: [],
				videoUrl: null,
				urlLive: null
			},
			{ amount: null, key: null, label: null, reason: 'odměny komisařů v přehledu nejsou' },
			'https://app.example'
		)!;
		expect(e.summary.startsWith('Komisař: BK Opava')).toBe(true);
		expect(e.description).toContain('Odměna: – (odměny komisařů v přehledu nejsou)');
		expect(e.description).not.toContain('Výsledek');
		expect(e.description).not.toContain('Live');
		expect(e.url).toBeUndefined();
	});

	it('is all-day without a time and skipped without a date', () => {
		const allDay = gameEvent({ ...base, startsAt: null }, undefined, 'https://app.example')!;
		expect(allDay.start).toBeUndefined();
		expect(allDay.date).toBe('2026-10-17');
		expect(allDay.description).not.toContain('Odměna');
		expect(gameEvent({ ...base, startsAt: null, scheduledDate: null }, undefined, '')).toBeNull();
	});

	it('leaves out unknown venue parts', () => {
		const e = gameEvent(
			{
				...base,
				venue: { name: 'Hala Vodova', street: null, zip: null, city: 'Brno', lat: null, lon: null }
			},
			fee,
			''
		)!;
		expect(e.location).toBe('Hala Vodova, Brno');
		expect(e.geo).toBeUndefined();
	});
});

describe('own games', () => {
	const own: OwnGame = {
		id: 3,
		date: '2026-12-28',
		title: 'Vánoční turnaj',
		role: 'referee',
		games: 4,
		fee: 1200,
		place: 'Hala Folimanka',
		note: 'platí pořadatel hotově'
	};

	it('are all-day events with the role, count, fee and note', () => {
		const e = ownGameEvent(own);
		expect(e).toEqual({
			uid: 'own-3@cbf-ref-interface',
			date: '2026-12-28',
			summary: 'Vánoční turnaj',
			location: 'Hala Folimanka',
			description: `Vlastní zápas · rozhodčí\nPočet zápasů: 4\nOdměna: ${formatKc(1200)}\nPoznámka: platí pořadatel hotově`
		});
	});

	it('follow the ČBF games in the feed', () => {
		const events = calendarEvents(
			[base],
			new Map([['544582:referee2', fee]]),
			[{ ...own, fee: null, note: null, games: 1, place: null }],
			'https://app.example'
		);
		expect(events.map((e) => e.uid)).toEqual([
			'game-544582-referee2@cbf-ref-interface',
			'own-3@cbf-ref-interface'
		]);
		expect(events[0].description).toContain(`Odměna: ≈ ${formatKc(600)}`);
		expect(events[1].description).toBe('Vlastní zápas · rozhodčí\nOdměna: neznámá');
		expect(events[1].location).toBeUndefined();
	});
});
