import { describe, expect, it } from 'vitest';
import { diffDelegation, type CurrentDelegation } from './delegation';

const jan = { id: 1001, groupId: 11, firstName: 'Jan', lastName: 'Novák', ratings: null };
const petr = { id: 1002, groupId: 12, firstName: 'Petr', lastName: 'Svoboda', ratings: null };
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
