import { describe, expect, it } from 'vitest';
import { diffDelegation, type CurrentDelegation } from './delegation';

const jan = { id: 1001, groupId: 11, firstName: 'Jan', lastName: 'Novák' };
const petr = { id: 1002, groupId: 12, firstName: 'Petr', lastName: 'Svoboda' };
const t0 = new Date('2026-10-01T10:00:00Z');
const t1 = new Date('2026-10-02T10:00:00Z');

const current: CurrentDelegation[] = [{ role: 'referee1', officialId: jan.id, observedAt: t0 }];

describe('diffDelegation', () => {
	it('assigns, confirms, replaces and removes in authoritative mode', () => {
		expect(
			diffDelegation(
				current,
				[
					{ role: 'referee1', official: petr },
					{ role: 'referee2', official: jan }
				],
				'authoritative',
				t1
			)
		).toEqual([
			{ type: 'replace', role: 'referee1', official: petr, previousOfficialId: jan.id },
			{ type: 'assign', role: 'referee2', official: jan }
		]);
		expect(
			diffDelegation(current, [{ role: 'referee1', official: jan }], 'authoritative', t1)
		).toEqual([{ type: 'confirm', role: 'referee1', official: jan }]);
		expect(
			diffDelegation(current, [{ role: 'referee1', official: null }], 'authoritative', t1)
		).toEqual([{ type: 'remove', role: 'referee1', previousOfficialId: jan.id }]);
	});

	it('ignores roles the snapshot does not carry', () => {
		expect(diffDelegation(current, [], 'authoritative', t1)).toEqual([]);
	});

	it('never lets an older observation win', () => {
		expect(
			diffDelegation(current, [{ role: 'referee1', official: petr }], 'authoritative', new Date(0))
		).toEqual([]);
	});

	it('does not let an older snapshot resurrect an official removed by a newer one', () => {
		// the row was deleted at t1, only the history remembers the removal
		const lastChange = new Map([['commissioner' as const, t1]]);
		expect(
			diffDelegation([], [{ role: 'commissioner', official: jan }], 'authoritative', t0, lastChange)
		).toEqual([]);
		expect(
			diffDelegation(
				[],
				[{ role: 'commissioner', official: jan }],
				'authoritative',
				new Date('2026-10-03T10:00:00Z'),
				lastChange
			)
		).toEqual([{ type: 'assign', role: 'commissioner', official: jan }]);
	});

	it('only fills empty roles in fill mode', () => {
		expect(
			diffDelegation(
				current,
				[
					{ role: 'referee1', official: petr },
					{ role: 'referee1', official: null },
					{ role: 'commissioner', official: petr }
				],
				'fill',
				t1
			)
		).toEqual([{ type: 'assign', role: 'commissioner', official: petr }]);
	});
});
