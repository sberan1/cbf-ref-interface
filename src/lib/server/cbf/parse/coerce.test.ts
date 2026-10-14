import { describe, expect, it } from 'vitest';
import {
	bool01,
	cbfDate,
	cbfTime,
	id,
	int,
	num,
	parseScoreTokens,
	periodsFromCumulative,
	pragueToUtc,
	scorePair,
	str
} from './coerce';

describe('scalar coercion', () => {
	it('treats empty values as null', () => {
		expect(str('  ')).toBeNull();
		expect(str(null)).toBeNull();
		expect(str({ '#text': ' Praha ' })).toBe('Praha');
		expect(int('')).toBeNull();
		expect(int('12a')).toBeNull();
		expect(int('42')).toBe(42);
		expect(int(7.9)).toBe(7);
	});

	it('uses null for zero IDs (ČBF "nobody")', () => {
		expect(id('0')).toBeNull();
		expect(id(0)).toBeNull();
		expect(id('273093')).toBe(273093);
	});

	it('parses floats with comma or dot', () => {
		expect(num('0,75')).toBe(0.75);
		expect(num('50.123')).toBe(50.123);
		expect(num('abc')).toBeNull();
	});

	it('parses 0/1 flags', () => {
		expect(bool01('1')).toBe(true);
		expect(bool01(0)).toBe(false);
		expect(bool01('')).toBeNull();
	});
});

describe('dates and times', () => {
	it('rejects 0000-00-00 and invalid dates', () => {
		expect(cbfDate('0000-00-00')).toBeNull();
		expect(cbfDate('2026-02-30')).toBeNull();
		expect(cbfDate('2026-10-14')).toBe('2026-10-14');
	});

	it('normalizes times and treats midnight as unset', () => {
		expect(cbfTime('18:00')).toBe('18:00:00');
		expect(cbfTime('9:30:00')).toBe('09:30:00');
		expect(cbfTime('00:00:00')).toBeNull();
		expect(cbfTime('25:00:00')).toBeNull();
	});

	it('converts Europe/Prague wall time to UTC across DST', () => {
		expect(pragueToUtc('2026-01-15', '18:00:00')?.toISOString()).toBe('2026-01-15T17:00:00.000Z');
		expect(pragueToUtc('2026-07-15', '18:00:00')?.toISOString()).toBe('2026-07-15T16:00:00.000Z');
		// the day DST ends (25 October 2026): 02:30 exists twice, 18:00 is already CET
		expect(pragueToUtc('2026-10-25', '18:00:00')?.toISOString()).toBe('2026-10-25T17:00:00.000Z');
		expect(pragueToUtc('2026-03-29', '12:00:00')?.toISOString()).toBe('2026-03-29T10:00:00.000Z');
		expect(pragueToUtc(null, '18:00:00')).toBeNull();
	});
});

describe('scores', () => {
	it('turns the cumulative score_quarter + final score into points per period', () => {
		// real shape: running score after Q1, Q2, Q3; the final score is separate
		expect(periodsFromCumulative(parseScoreTokens('13:8 32:26 58:48'), [78, 80])).toEqual([
			{ period: 1, home: 13, away: 8 },
			{ period: 2, home: 19, away: 18 },
			{ period: 3, home: 26, away: 22 },
			{ period: 4, home: 20, away: 32 }
		]);
	});

	it('puts overtime into period 5', () => {
		const periods = periodsFromCumulative(parseScoreTokens('26:15 47:36 72:49 83:83'), [99, 93]);
		expect(periods).toHaveLength(5);
		expect(periods[3]).toEqual({ period: 4, home: 11, away: 34 });
		expect(periods[4]).toEqual({ period: 5, home: 16, away: 10 });
	});

	it('rejects sequences that are not cumulative', () => {
		expect(periodsFromCumulative(parseScoreTokens('20:18 15:22 17:20'), [52, 60])).toEqual([]);
		expect(parseScoreTokens('')).toEqual([]);
		expect(parseScoreTokens(null)).toEqual([]);
	});

	it('maps 0:0 to "not played"', () => {
		expect(scorePair('0', '0')).toEqual([null, null]);
		expect(scorePair('20', '0')).toEqual([20, 0]);
		expect(scorePair('81', '77')).toEqual([81, 77]);
	});
});
