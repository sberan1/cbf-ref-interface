/**
 * In-process scheduler of the recurring sync plans (ADR 0007): `daily` once a day at a fixed
 * Europe/Prague time, `window` every few hours. Replaces host cron in the Docker deployment.
 * Both jobs only enqueue tasks; freshness checks keep reruns (e.g. after a deploy) cheap.
 */
const pragueClockFormat = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Prague',
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit'
});

export function pragueClock(now: Date): { date: string; time: string } {
	const p = Object.fromEntries(pragueClockFormat.formatToParts(now).map((x) => [x.type, x.value]));
	return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export interface CronState {
	/** Prague date of the last daily run */
	lastDaily: string | null;
	/** epoch ms of the last window run */
	lastWindow: number | null;
}

export type CronJob = 'daily' | 'window';

/**
 * Jobs due at `now`. Daily runs once per Prague day as soon as the clock passes `dailyAt` (so a
 * scheduler started later that day still runs it); window runs on start and then every interval.
 */
export function dueJobs(
	state: CronState,
	now: Date,
	opts: { dailyAt: string; windowEveryMs: number }
): CronJob[] {
	const jobs: CronJob[] = [];
	const { date, time } = pragueClock(now);
	if (time >= opts.dailyAt && state.lastDaily !== date) jobs.push('daily');
	if (state.lastWindow === null || now.getTime() - state.lastWindow >= opts.windowEveryMs) {
		jobs.push('window');
	}
	return jobs;
}

export function markDone(state: CronState, job: CronJob, now: Date): CronState {
	return job === 'daily'
		? { ...state, lastDaily: pragueClock(now).date }
		: { ...state, lastWindow: now.getTime() };
}
