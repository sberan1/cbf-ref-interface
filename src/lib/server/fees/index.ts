/**
 * Fee of one delegation (PDR 0002): the competition's line of the schedule in force on the game
 * date, times 1.5 when a single referee led a played game and the schedule says so.
 */
import { classifyCompetition, type CompetitionInfo } from './classify';
import {
	feeLabels,
	scheduleFor,
	scopeOf,
	schedules,
	type FeeKey,
	type FeeSchedule,
	type Provenance
} from './schedules';

export interface FeeGame extends CompetitionInfo {
	role: string;
	date: string | null;
	/** referees (not the commissioner) delegated to the game */
	refereeCount: number;
	played: boolean;
}

export type GameFee =
	| {
			amount: number;
			key: FeeKey;
			label: string;
			scheduleId: string;
			/** provenance of the rate; `assumed` also when the competition mapping is a guess */
			provenance: Provenance;
			note: string | null;
			singleReferee: boolean;
	  }
	| { amount: null; key: FeeKey | null; label: string | null; reason: string };

export function gameFee(game: FeeGame, list: FeeSchedule[] = schedules): GameFee {
	if (game.role === 'commissioner') {
		return { amount: null, key: null, label: null, reason: 'odměny komisařů v přehledu nejsou' };
	}
	const c = classifyCompetition(game);
	if (c.key === null) return { amount: null, key: null, label: null, reason: c.reason };
	const label = feeLabels[c.key];
	if (!game.date) return { amount: null, key: c.key, label, reason: 'zápas nemá datum' };

	const schedule = scheduleFor(scopeOf(c.key), game.date, list);
	const rate = schedule?.rates[c.key];
	if (!schedule || rate === undefined) {
		return { amount: null, key: c.key, label, reason: 'sazba pro toto období chybí' };
	}

	const single =
		game.played &&
		game.refereeCount === 1 &&
		!!schedule.singleReferee &&
		!(schedule.singleReferee.except ?? []).includes(c.key);
	const amount = Math.round(rate * (single ? schedule.singleReferee!.multiplier : 1));
	const notes = [c.assumption, schedule.provenance === 'document' ? null : schedule.source];
	return {
		amount,
		key: c.key,
		label,
		scheduleId: schedule.id,
		provenance: c.assumption ? 'assumed' : schedule.provenance,
		note: notes.filter(Boolean).join('; ') || null,
		singleReferee: single
	};
}

export { schedules, feeLabels, type FeeKey, type Provenance };
