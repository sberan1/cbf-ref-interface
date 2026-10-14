import type { OfficialRole } from '../../db/schema';
import type { ObservedOfficial, ParsedPerson } from '../parse/types';

export interface CurrentDelegation {
	role: OfficialRole;
	officialId: number;
	observedAt: Date;
}

/**
 * - `authoritative`: the snapshot is the truth for every role it carries (v2 game / games list);
 *   an explicit vacancy removes the official.
 * - `fill`: the source only adds officials to empty roles and never overrides (v1 sched).
 */
export type DelegationMode = 'authoritative' | 'fill';

export type DelegationOp =
	| { type: 'assign'; role: OfficialRole; official: ParsedPerson }
	| { type: 'replace'; role: OfficialRole; official: ParsedPerson; previousOfficialId: number }
	| { type: 'confirm'; role: OfficialRole; official: ParsedPerson }
	| { type: 'remove'; role: OfficialRole; previousOfficialId: number };

/**
 * Compares the current delegation with a new snapshot. Observations older than what we already
 * know (e.g. re-normalizing an old payload) never win.
 */
export function diffDelegation(
	current: CurrentDelegation[],
	observed: ObservedOfficial[],
	mode: DelegationMode,
	observedAt: Date
): DelegationOp[] {
	const byRole = new Map(current.map((c) => [c.role, c]));
	const ops: DelegationOp[] = [];
	for (const { role, official } of observed) {
		const existing = byRole.get(role);
		if (existing && existing.observedAt.getTime() > observedAt.getTime()) continue;
		if (!official) {
			if (existing && mode === 'authoritative') {
				ops.push({ type: 'remove', role, previousOfficialId: existing.officialId });
			}
			continue;
		}
		if (!existing) {
			ops.push({ type: 'assign', role, official });
		} else if (existing.officialId === official.id) {
			if (mode === 'authoritative') ops.push({ type: 'confirm', role, official });
		} else if (mode === 'authoritative') {
			ops.push({ type: 'replace', role, official, previousOfficialId: existing.officialId });
		}
	}
	return ops;
}
