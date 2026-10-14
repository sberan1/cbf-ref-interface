import { describe, expect, it } from 'vitest';
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
