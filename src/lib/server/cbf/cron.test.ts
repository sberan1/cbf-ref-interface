import { describe, expect, it } from 'vitest';
import { dueJobs, markDone, pragueClock, type CronState } from './cron';

const opts = { dailyAt: '04:30', windowEveryMs: 6 * 3600_000 };

describe('scheduler', () => {
	it('reads the Prague wall clock', () => {
		expect(pragueClock(new Date('2026-10-14T02:45:00Z'))).toEqual({
			date: '2026-10-14',
			time: '04:45'
		});
		expect(pragueClock(new Date('2026-12-31T23:10:00Z'))).toEqual({
			date: '2027-01-01',
			time: '00:10'
		});
	});

	it('runs window on start and daily after the configured time, once a day', () => {
		let state: CronState = { lastDaily: null, lastWindow: null };
		const early = new Date('2026-10-14T01:00:00Z'); // 03:00 Prague
		expect(dueJobs(state, early, opts)).toEqual(['window']);
		state = markDone(state, 'window', early);

		const afterDaily = new Date('2026-10-14T02:31:00Z'); // 04:31 Prague
		expect(dueJobs(state, afterDaily, opts)).toEqual(['daily']);
		state = markDone(state, 'daily', afterDaily);
		expect(dueJobs(state, new Date('2026-10-14T05:00:00Z'), opts)).toEqual([]);

		const later = new Date('2026-10-14T07:00:00Z'); // 6 h after the first window
		expect(dueJobs(state, later, opts)).toEqual(['window']);
		expect(dueJobs(state, new Date('2026-10-15T02:30:00Z'), opts)).toContain('daily');
	});
});
