import { describe, expect, it } from 'vitest';
import { ownGameRows, ownGameSchema, type OwnGame } from './own-games';

const form = (over: Record<string, string> = {}) => ({
	date: '2026-11-15',
	time: '',
	title: 'Traiskirschen Lions – Sokol Pražský',
	role: 'referee',
	games: '1',
	fee: '600',
	place: 'Folimanka',
	note: 'EYBL',
	...over
});

describe('ownGameSchema', () => {
	it('takes an optional start time', () => {
		expect(ownGameSchema.parse(form()).time).toBeNull();
		expect(ownGameSchema.parse(form({ time: '17:30' })).time).toBe('17:30');
		expect(ownGameSchema.parse({ ...form(), time: undefined }).time).toBeNull();
		expect(ownGameSchema.safeParse(form({ time: '25:00' })).success).toBe(false);
	});
});

describe('ownGameRows', () => {
	const own: OwnGame = { id: 7, ...ownGameSchema.parse(form({ time: '17:30' })) };

	it('fits the dashboard game lists, with the Prague start time', () => {
		const [row] = ownGameRows([own]);
		expect(row).toMatchObject({
			kind: 'own',
			id: 7,
			scheduledDate: '2026-11-15',
			role: 'referee',
			roleName: 'rozhodčí',
			title: 'Traiskirschen Lions – Sokol Pražský',
			venue: 'Folimanka',
			note: 'EYBL',
			fee: { amount: 600, estimate: false }
		});
		expect(row.startsAt?.toISOString()).toBe('2026-11-15T16:30:00.000Z');
	});

	it('has no start without a time and keeps an unknown fee', () => {
		const [row] = ownGameRows([{ ...own, time: null, fee: null, role: 'commissioner' }]);
		expect(row.startsAt).toBeNull();
		expect(row.role).toBe('commissioner');
		expect(row.fee.amount).toBeNull();
	});
});
