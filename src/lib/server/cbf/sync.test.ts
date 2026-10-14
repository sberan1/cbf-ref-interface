import { describe, expect, it } from 'vitest';
import { currentSeasonYear, loadConfig, parseIntList } from './config';
import { buildUrl, endpoints, normalizeParams, requestKey } from './endpoints';
import { RateLimiter } from './rate-limiter';
import { defaultNextDueAt, gameDetailNextDueAt } from './refresh-policy';
import { bootstrapTasks } from './scheduler';
import { taskPriority } from './tasks';
import type { ParsedGame } from './parse/types';

describe('config', () => {
	it('parses integer lists', () => {
		expect(parseIntList('0-3, 9,12-13,3')).toEqual([0, 1, 2, 3, 9, 12, 13]);
		expect(() => parseIntList('5-1')).toThrow();
		expect(() => parseIntList('x')).toThrow();
	});

	it('derives the current season from the date', () => {
		const config = { currentSeasonYear: undefined };
		expect(currentSeasonYear(config, new Date('2026-10-14T00:00:00Z'))).toBe(2026);
		expect(currentSeasonYear(config, new Date('2027-03-01T00:00:00Z'))).toBe(2026);
		expect(currentSeasonYear({ currentSeasonYear: 2030 })).toBe(2030);
	});

	it('has polite defaults', () => {
		const config = loadConfig({});
		expect(config.http.minIntervalMs).toBe(2000);
		expect(config.http.jitterMs).toBe(1000);
		expect(config.areas).toEqual([...Array(15).keys()]);
	});
});

describe('endpoints', () => {
	it('builds canonical request keys and URLs', () => {
		const def = endpoints['v2.divs'];
		const params = normalizeParams(def, { season: 2026, female: 0, area: 7 });
		expect(requestKey(def, params)).toBe('v2:api/divs.php?area=7&female=0&season=2026');
		expect(buildUrl('https://www.cbf.cz/xml/', def, params)).toBe(
			'https://www.cbf.cz/xml/api/divs.php?season=2026&female=0&area=7&json=1'
		);
		expect(buildUrl('https://www.cbf.cz/xml/', endpoints['v1.sched'], { p: '4451' })).toBe(
			'https://www.cbf.cz/xml/sched.php?p=4451'
		);
	});

	it('rejects missing and unknown params', () => {
		expect(() => normalizeParams(endpoints['v2.game'], {})).toThrow(/missing/);
		expect(() => normalizeParams(endpoints['v2.game'], { game: 1, x: 2 })).toThrow(/unknown/);
	});
});

describe('RateLimiter', () => {
	it('spaces requests and honours pauses', async () => {
		let now = 0;
		const waits: number[] = [];
		const limiter = new RateLimiter(
			2000,
			1000,
			() => now,
			async (ms) => {
				waits.push(ms);
				now += ms;
			},
			() => 0.5
		);
		await limiter.acquire();
		await limiter.acquire();
		limiter.pause(60_000);
		await limiter.acquire();
		expect(waits).toEqual([2500, 60_000]);
	});
});

describe('scheduling', () => {
	it('enqueues newest seasons first with higher priority', () => {
		const tasks = bootstrapTasks(2006, 2026, { areas: [0, 1], genders: [0, 1] });
		expect(tasks).toHaveLength(1 + 21 * (1 + 2 * 2));
		expect(tasks[1].ctx.seasonYear).toBe(2026);
		expect(tasks.at(-1)?.ctx.seasonYear).toBe(2006);
		const p = (seasonYear: number) =>
			taskPriority({ reason: 'bootstrap', ctx: { seasonYear } }, 2026);
		expect(p(2026)).toBeGreaterThan(p(2015));
		expect(p(2006)).toBeGreaterThanOrEqual(1);
		expect(taskPriority({ reason: 'window', ctx: {} }, 2026)).toBeGreaterThan(p(2026));
	});

	it('treats historical seasons as immutable', () => {
		const now = new Date('2026-10-14T12:00:00Z');
		expect(defaultNextDueAt('v2.games', { seasonYear: 2015 }, 2026, now)).toBeNull();
		expect(defaultNextDueAt('v2.games', { seasonYear: 2026 }, 2026, now)?.getTime()).toBe(
			now.getTime() + 20 * 3600_000
		);
	});

	it('refreshes game details around the game and stops once final', () => {
		const now = new Date('2026-10-14T12:00:00Z');
		const game = (startsAt: string, score: boolean) =>
			({
				startsAt: new Date(startsAt),
				homeScore: score ? 80 : null,
				awayScore: score ? 70 : null
			}) as ParsedGame;
		expect(gameDetailNextDueAt(game('2026-10-01T16:00:00Z', true), now)).toBeNull();
		expect(gameDetailNextDueAt(game('2026-10-20T16:00:00Z', false), now)?.getTime()).toBe(
			now.getTime() + 6 * 3600_000
		);
		expect(gameDetailNextDueAt(game('2026-12-20T16:00:00Z', false), now)?.getTime()).toBe(
			now.getTime() + 7 * 24 * 3600_000
		);
	});
});
