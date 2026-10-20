import { describe, expect, it } from 'vitest';
import type { GameFee } from '../fees';
import { summarizeEarnings, type FeeRow } from './earnings';
import type { OwnGame } from './own-games';
import { yearCsv } from './year-export';

const fee = (amount: number, provenance: 'document' | 'assumed' = 'document'): GameFee =>
	({
		amount,
		key: 'praha.t2',
		label: '3. třída',
		scheduleId: 'praha-2025',
		provenance,
		note: null,
		singleReferee: false
	}) as GameFee;

const row = (date: string, amount: number, played = true, provenance?: 'assumed'): FeeRow => ({
	gameId: Number(date.replace(/-/g, '')),
	role: 'referee1',
	date,
	seasonYear: Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0),
	competitionId: 1,
	competitionName: '3. třída A',
	categoryName: 'muži',
	homeTeam: 'Slovan',
	awayTeam: 'Slavoj',
	played,
	fee: fee(amount, provenance)
});

const own = (date: string, fee: number | null, games = 1): OwnGame => ({
	id: 1,
	date,
	title: 'Turnaj U13',
	role: 'referee',
	games,
	fee,
	place: 'Kladno',
	note: null
});

describe('summarizeEarnings by calendar year', () => {
	it('splits seasons into calendar years and adds own games', () => {
		const e = summarizeEarnings(
			[
				row('2025-10-04', 600),
				row('2026-02-14', 600, true, 'assumed'),
				row('2026-11-01', 700, false)
			],
			2026,
			{ games: [own('2025-12-20', 1500, 4), own('2026-12-01', 900)], today: '2026-10-20' }
		);
		expect(e.years).toEqual([
			{ year: 2026, paidGames: 1, earned: 600, estimated: 600 },
			{ year: 2025, paidGames: 5, earned: 2100, estimated: 0 }
		]);
		// season 2025/26 holds both ČBF games and the tournament
		expect(e.seasons.find((s) => s.seasonYear === 2025)).toMatchObject({
			paidGames: 6,
			earned: 2700
		});
		expect(e.own).toEqual({ games: 4, earned: 1500 });
		expect(e.upcoming).toBe(700 + 900);
		expect(e.earned).toBe(600 + 600 + 1500);
	});
});

describe('yearCsv', () => {
	it('lists the year with Czech number formatting and totals', () => {
		const csv = yearCsv(
			2025,
			[row('2025-10-04', 600), row('2026-02-14', 600)],
			[],
			[own('2025-12-20', 1500, 4)],
			'2026-10-20'
		);
		const lines = csv.replace('﻿', '').trim().split('\r\n');
		expect(lines[0].split(';')[0]).toBe('Typ');
		expect(lines[1]).toContain(
			'odměna ČBF;2025-10-04;3. třída A;muži;Slovan – Slavoj;1. rozhodčí;1;600'
		);
		expect(lines[2]).toContain('vlastní zápas;2025-12-20;Turnaj U13;;Kladno;rozhodčí;4;1500');
		expect(csv).not.toContain('2026-02-14');
		expect(lines.at(-2)).toBe('součet odměn;;;;;;;2100;;;;2100');
	});
});
