/**
 * Allowances of one game day (PDR 0003): mileage for the car trip split into the parts driven
 * alone and with colleagues, the meal allowance from the trip length (driving + 3 h 30 min per
 * game) and the weekday supplement of ČBF competitions.
 */
import { z } from 'zod';
import { classifyCompetition, type CompetitionInfo } from '../fees/classify';
import { foldText } from '../referee/text';
import { holidayName, isWeekend } from './holidays';
import { MINUTES_PER_GAME, mealAmount, mealFor, mileageFor } from './rates';

export const tripModes = ['car', 'passenger', 'public', 'none'] as const;
export type TripMode = (typeof tripModes)[number];

export const tripStopSchema = z.object({
	kind: z.enum(['home', 'venue', 'pickup', 'dropoff']),
	label: z.string().max(200),
	address: z.string().max(300).nullish(),
	lat: z.number().min(-90).max(90).nullish(),
	lon: z.number().min(-180).max(180).nullish(),
	municipality: z.string().max(120).nullish(),
	/** pickup / drop-off: who */
	colleague: z.string().max(120).nullish(),
	/** venue stops: the games played there */
	gameIds: z.array(z.number().int()).max(50).nullish()
});
export type TripStop = z.infer<typeof tripStopSchema>;

export interface TripLeg {
	meters: number;
	seconds: number;
	/** colleagues in the car on this leg */
	passengers: number;
	approximate: boolean;
}

/** Colleagues in the car on each leg `stops[i] → stops[i + 1]`. */
export function passengersByLeg(stops: Pick<TripStop, 'kind'>[]): number[] {
	const out: number[] = [];
	let inCar = 0;
	for (let i = 0; i < stops.length - 1; i++) {
		if (stops[i].kind === 'pickup') inCar++;
		if (stops[i].kind === 'dropoff') inCar = Math.max(0, inCar - 1);
		out.push(inCar);
	}
	return out;
}

export interface DayGame extends CompetitionInfo {
	gameId: number;
	role: string;
	venueMunicipality: string | null;
}

export interface DayAllowance {
	mode: TripMode;
	km: { alone: number; shared: number };
	rates: { alone: number; shared: number };
	mileage: number;
	tickets: number;
	extra: number;
	travel: number;
	minutes: { driving: number; games: number };
	meal: number;
	weekday: number;
	weekdayNote: string | null;
	total: number;
	/** some rate is assumed, or a leg was measured as the crow flies */
	estimated: boolean;
	/** mileage, meal or weekday rates of a period without an overview */
	ratesAssumed: boolean;
	notes: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** NBL, ŽBL, 1. liga mužů and Český pohár pay the higher shared mileage rate. */
export function isTopCompetition(game: CompetitionInfo): boolean {
	if (game.areaId !== 0) return false;
	const name = foldText(`${game.leagueName ?? ''} ${game.competitionName ?? ''}`);
	if (/\bnbl\b|\bzbl\b|zenska basketbalova liga|pohar/.test(name)) return true;
	return classifyCompetition(game).key === 'cbf.m.liga1';
}

function sameMunicipality(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false;
	const norm = (s: string) =>
		foldText(s)
			.replace(/\s*-\s*/g, '-')
			.replace(/\s+\d+$/, '')
			.trim();
	return norm(a) === norm(b);
}

export function computeDayAllowance(input: {
	date: string;
	mode: TripMode;
	legs: TripLeg[];
	games: DayGame[];
	ticketCost?: number | null;
	extraCost?: number | null;
	homeMunicipality?: string | null;
}): DayAllowance {
	const { date, mode, games } = input;
	const notes: string[] = [];
	let ratesAssumed = false;
	const rates = mileageFor(date);
	if (!rates || rates.provenance !== 'document') ratesAssumed = true;
	let estimated = false;

	const travels = mode !== 'none';
	const legs = travels ? input.legs : [];
	if (legs.some((l) => l.approximate)) {
		estimated = true;
		notes.push('Část trasy je odhadnutá vzdušnou čarou (mapy nebyly dostupné).');
	}
	const kmAlone = round1(
		legs.filter((l) => l.passengers === 0).reduce((s, l) => s + l.meters, 0) / 1000
	);
	const kmShared = round1(
		legs.filter((l) => l.passengers > 0).reduce((s, l) => s + l.meters, 0) / 1000
	);
	const top = games.some(isTopCompetition);
	const rateAlone = rates?.alone ?? 0;
	const rateShared = (top ? rates?.sharedTop : rates?.shared) ?? 0;
	const mileage = mode === 'car' ? Math.round(kmAlone * rateAlone + kmShared * rateShared) : 0;
	const tickets = mode === 'public' ? Math.max(0, input.ticketCost ?? 0) : 0;
	const extra = Math.max(0, input.extraCost ?? 0);

	const gameCount = new Set(games.map((g) => g.gameId)).size;
	const drivingMinutes = Math.round(legs.reduce((s, l) => s + l.seconds, 0) / 60);
	const gameMinutes = gameCount * MINUTES_PER_GAME;
	const meals = mealFor(date);
	if (meals && meals.provenance !== 'document') ratesAssumed = true;
	const meal = meals ? mealAmount(meals, (drivingMinutes + gameMinutes) / 60) : 0;

	let weekday = 0;
	let weekdayNote: string | null = null;
	const national = games.filter((g) => g.areaId === 0);
	if (national.length > 0) {
		const holiday = holidayName(date);
		if (isWeekend(date)) weekdayNote = 'víkend';
		else if (holiday) weekdayNote = `svátek: ${holiday}`;
		else if (
			input.homeMunicipality &&
			national.every((g) => sameMunicipality(g.venueMunicipality, input.homeMunicipality))
		) {
			weekdayNote = 'zápas v místě bydliště';
		} else {
			const cup = national.some((g) => classifyCompetition(g).key?.startsWith('cp.'));
			const amount = cup ? (rates?.weekday.cup ?? rates?.weekday.cbf) : rates?.weekday.cbf;
			weekday = amount ?? 0;
			if (cup && rates?.weekday.cup == null) ratesAssumed = true;
		}
	}

	const travel = mileage + tickets + extra;
	return {
		mode,
		km: { alone: kmAlone, shared: kmShared },
		rates: { alone: rateAlone, shared: rateShared },
		mileage,
		tickets,
		extra,
		travel,
		minutes: { driving: drivingMinutes, games: gameMinutes },
		meal,
		weekday,
		weekdayNote,
		total: travel + meal + weekday,
		estimated: estimated || ratesAssumed,
		ratesAssumed,
		notes
	};
}
