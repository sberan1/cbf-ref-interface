import { describe, expect, it } from 'vitest';
import {
	bucketKeyBefore,
	bucketLabel,
	currentBucketKey,
	fillTimeline,
	seasonLabel,
	weekStart
} from './timeline';

const now = new Date('2026-10-14T12:00:00Z'); // Wednesday

describe('timeline buckets', () => {
	it('labels seasons, months and weeks', () => {
		expect(seasonLabel(2026)).toBe('2026/27');
		expect(seasonLabel(1999)).toBe('1999/00');
		expect(bucketLabel('month', '2026-10')).toBe('říj 2026');
		expect(bucketLabel('week', '2026-10-12')).toBe('12. 10.');
	});

	it('finds the Monday of an ISO week and range edges', () => {
		expect(weekStart(now).toISOString().slice(0, 10)).toBe('2026-10-12');
		expect(weekStart(new Date('2026-10-18T22:00:00Z')).toISOString().slice(0, 10)).toBe(
			'2026-10-12'
		);
		expect(currentBucketKey('month', now, 2026)).toBe('2026-10');
		expect(bucketKeyBefore('month', now, 2026, 23)).toBe('2024-11');
		expect(bucketKeyBefore('week', now, 2026, 2)).toBe('2026-09-28');
		expect(bucketKeyBefore('season', now, 2026, 3)).toBe('2023');
	});

	it('fills gaps, merges roles and marks the future', () => {
		const buckets = fillTimeline(
			'month',
			[
				{ key: '2026-08', role: 'referee', count: 2 },
				{ key: '2026-08', role: 'commissioner', count: 1 },
				{ key: '2026-11', role: 'referee', count: 1 }
			],
			{ now, currentSeasonYear: 2026, from: '2026-07', to: '2026-10' }
		);
		expect(buckets.map((b) => [b.key, b.referee, b.commissioner, b.future])).toEqual([
			['2026-07', 0, 0, false],
			['2026-08', 2, 1, false],
			['2026-09', 0, 0, false],
			['2026-10', 0, 0, false],
			['2026-11', 1, 0, true]
		]);
	});

	it('crosses year boundaries for weeks and seasons', () => {
		const weeks = fillTimeline('week', [{ key: '2027-01-04', role: 'referee', count: 1 }], {
			now,
			currentSeasonYear: 2026,
			from: '2026-12-21'
		});
		expect(weeks.map((b) => b.key)).toEqual(['2026-12-21', '2026-12-28', '2027-01-04']);
		const seasons = fillTimeline(
			'season',
			[
				{ key: '2012', role: 'commissioner', count: 3 },
				{ key: '2014', role: 'referee', count: 1 }
			],
			{ now, currentSeasonYear: 2026, to: '2015' }
		);
		expect(seasons.map((b) => b.label)).toEqual(['2012/13', '2013/14', '2014/15', '2015/16']);
	});

	it('returns nothing without data or range', () => {
		expect(fillTimeline('season', [], { now, currentSeasonYear: 2026 })).toEqual([]);
	});
});
