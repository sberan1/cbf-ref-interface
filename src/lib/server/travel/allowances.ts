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

/**
 * `car`: by car, driving from home; `passenger`: by car, a colleague drives from home. Changing
 * cars on the way (`ride` / `drive` stops) switches who drives from there on.
 */
export const tripModes = ['car', 'passenger', 'public', 'none'] as const;
export type TripMode = (typeof tripModes)[number];

/**
 * home and venues come from the server; pickup / dropoff: a colleague gets in or out of my car;
 * ride: I leave my car at a colleague's and ride in his; drive: I am back in my car.
 */
export const tripStopKinds = ['home', 'venue', 'pickup', 'dropoff', 'ride', 'drive'] as const;

export const tripStopSchema = z.object({
	kind: z.enum(tripStopKinds),
	label: z.string().max(200),
	address: z.string().max(300).nullish(),
	lat: z.number().min(-90).max(90).nullish(),
	lon: z.number().min(-180).max(180).nullish(),
	municipality: z.string().max(120).nullish(),
	/** pickup / drop-off / change of car: who */
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

/** Whether I drive on each leg `stops[i] → stops[i + 1]`: from the start, then by changes of car. */
export function drivingByLeg(stops: Pick<TripStop, 'kind'>[], fromHome: boolean): boolean[] {
	const out: boolean[] = [];
	let driving = fromHome;
	for (let i = 0; i < stops.length - 1; i++) {
		if (stops[i].kind === 'ride') driving = false;
		if (stops[i].kind === 'drive') driving = true;
		out.push(driving);
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
	/** driven alone / with colleagues, and ridden in a colleague's car (paid to the driver) */
	km: { alone: number; shared: number; passenger: number };
	rates: { alone: number; shared: number };
	mileage: number;
	tickets: number;
	extra: number;
	travel: number;
	minutes: { driving: number; games: number };
	meal: number;
	/** why there is no meal allowance (all games in the home municipality) */
	mealNote: string | null;
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

/**
 * Same municipality, ignoring city districts: "Praha 8 - Bohnice" and "Praha 9" are both Praha,
 * "Frýdek-Místek" stays one name.
 */
export function sameMunicipality(
	a: string | null | undefined,
	b: string | null | undefined
): boolean {
	if (!a || !b) return false;
	const norm = (s: string) =>
		foldText(s)
			.trim()
			.replace(/\s*-\s*/g, '-')
			.replace(/\s+\d+(?=-|$)/, '');
	const x = norm(a);
	const y = norm(b);
	return x === y || x.startsWith(`${y}-`) || y.startsWith(`${x}-`);
}

export function computeDayAllowance(input: {
	date: string;
	mode: TripMode;
	legs: TripLeg[];
	/** the stops the legs connect, for changes of car; without them the mode decides who drives */
	stops?: Pick<TripStop, 'kind'>[];
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
	// mileage is paid to whoever drives: legs in a colleague's car are his
	const byCar = mode === 'car' || mode === 'passenger';
	const driving =
		byCar && input.stops?.length === legs.length + 1
			? drivingByLeg(input.stops, mode === 'car')
			: legs.map(() => mode === 'car');
	const km = (pick: (l: TripLeg, i: number) => boolean) =>
		round1(legs.filter(pick).reduce((s, l) => s + l.meters, 0) / 1000);
	const kmAlone = km((l, i) => driving[i] && l.passengers === 0);
	const kmShared = km((l, i) => driving[i] && l.passengers > 0);
	const kmPassenger = byCar ? km((_, i) => !driving[i]) : 0;
	if (kmPassenger > 0 && kmAlone + kmShared > 0) {
		notes.push('Část cesty jako spolujezdec: cestovné za ni bere řidič.');
	}
	const top = games.some(isTopCompetition);
	const rateAlone = rates?.alone ?? 0;
	const rateShared = (top ? rates?.sharedTop : rates?.shared) ?? 0;
	const mileage = Math.round(kmAlone * rateAlone + kmShared * rateShared);
	const tickets = mode === 'public' ? Math.max(0, input.ticketCost ?? 0) : 0;
	const extra = Math.max(0, input.extraCost ?? 0);

	const gameCount = new Set(games.map((g) => g.gameId)).size;
	const drivingMinutes = Math.round(legs.reduce((s, l) => s + l.seconds, 0) / 60);
	const gameMinutes = gameCount * MINUTES_PER_GAME;
	const meals = mealFor(date);
	if (meals && meals.provenance !== 'document') ratesAssumed = true;
	// § 152 ZP: a trip within the municipality of residence is no business trip, so no meal allowance
	const atHome =
		!!input.homeMunicipality &&
		games.length > 0 &&
		games.every((g) => sameMunicipality(g.venueMunicipality, input.homeMunicipality));
	const mealNote = atHome ? 'zápas v obci bydliště' : null;
	const meal = meals && !atHome ? mealAmount(meals, (drivingMinutes + gameMinutes) / 60) : 0;

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
		km: { alone: kmAlone, shared: kmShared, passenger: kmPassenger },
		rates: { alone: rateAlone, shared: rateShared },
		mileage,
		tickets,
		extra,
		travel,
		minutes: { driving: drivingMinutes, games: gameMinutes },
		meal,
		mealNote,
		weekday,
		weekdayNote,
		total: travel + meal + weekday,
		estimated: estimated || ratesAssumed,
		ratesAssumed,
		notes
	};
}
