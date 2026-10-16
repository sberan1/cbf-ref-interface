import { describe, expect, it } from 'vitest';
import { gameStatus } from './earnings';
import { foldText, pragueToday } from './queries';

describe('referee queries helpers', () => {
	it('folds Czech diacritics for search', () => {
		expect(foldText('Šikner ŘEŽÁBEK Dvořák')).toBe('sikner rezabek dvorak');
	});

	it('uses the Prague calendar day', () => {
		// 23:30 UTC on 14 Oct is already 15 Oct in Prague (CEST)
		expect(pragueToday(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-15');
		expect(pragueToday(new Date('2026-01-14T22:30:00Z'))).toBe('2026-01-14');
	});
});

describe('gameStatus', () => {
	it('waits a day for a missing result before calling a game cancelled', () => {
		expect(gameStatus('2026-10-16', false, '2026-10-16')).toBe('expected');
		expect(gameStatus('2026-10-16', false, '2026-10-17')).toBe('expected');
		expect(gameStatus('2026-10-16', false, '2026-10-18')).toBe('cancelled');
		expect(gameStatus('2026-10-16', true, '2026-10-16')).toBe('played');
		expect(gameStatus('2026-10-31', false, '2026-11-02')).toBe('cancelled');
		expect(gameStatus('2026-10-20', false, '2026-10-16')).toBe('expected');
		expect(gameStatus(null, false, '2026-10-16')).toBe('expected');
	});
});
