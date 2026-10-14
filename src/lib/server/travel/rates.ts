/**
 * Travel and meal allowances (PDR 0003), from the "Náhrada cestovních výdajů a stravné" chapter
 * of the fee overviews. Mileage and the weekday supplement follow the season's overview; the
 * meal allowance follows the government decree in force on the trip date (calendar year).
 */
import type { Provenance } from '../fees/schedules';

export interface MileageRates {
	id: string;
	validFrom: string;
	validTo?: string;
	provenance: Provenance;
	source: string;
	/** Kč/km, driving alone */
	alone: number;
	/** Kč/km for the driver on the part of the trip shared with colleagues */
	shared: number;
	/** shared rate in the top competitions (NBL, ŽBL, 1. liga mužů, Český pohár) */
	sharedTop: number;
	/** weekday supplement per day: ČBF leagues and NRL, Český pohár (null = unknown) */
	weekday: { cbf: number; cup: number | null };
}

export const mileageRates: MileageRates[] = [
	{
		id: 'km-2017',
		validFrom: '2017-07-01',
		validTo: '2023-07-01',
		provenance: 'assumed',
		source: 'předpoklad: stejné jako 2023/24',
		alone: 4.5,
		shared: 5,
		sharedTop: 6.3,
		weekday: { cbf: 300, cup: null }
	},
	{
		id: 'km-2023',
		validFrom: '2023-07-01',
		validTo: '2025-07-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2023/24',
		alone: 4.5,
		shared: 5,
		sharedTop: 6.3,
		weekday: { cbf: 300, cup: null }
	},
	{
		id: 'km-2025',
		validFrom: '2025-07-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2025/26 a 2026/27',
		alone: 4.5,
		shared: 5,
		sharedTop: 6.3,
		weekday: { cbf: 300, cup: 650 }
	}
];

export interface MealRates {
	validFrom: string;
	provenance: Provenance;
	source: string;
	/** amount for a trip of at least `hours` hours, ascending */
	tiers: { hours: number; amount: number }[];
}

export const mealRates: MealRates[] = [
	{
		validFrom: '2017-01-01',
		provenance: 'assumed',
		source: 'předpoklad: stejné jako 2023',
		tiers: [
			{ hours: 5, amount: 129 },
			{ hours: 12, amount: 196 },
			{ hours: 18, amount: 307 }
		]
	},
	{
		validFrom: '2023-01-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2023/24',
		tiers: [
			{ hours: 5, amount: 129 },
			{ hours: 12, amount: 196 },
			{ hours: 18, amount: 307 }
		]
	},
	{
		validFrom: '2024-01-01',
		provenance: 'assumed',
		source: 'vyhláška MPSV pro rok 2024 (v přehledech není)',
		tiers: [
			{ hours: 5, amount: 140 },
			{ hours: 12, amount: 212 },
			{ hours: 18, amount: 333 }
		]
	},
	{
		validFrom: '2025-01-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2025/26',
		tiers: [
			{ hours: 5, amount: 148 },
			{ hours: 12, amount: 225 },
			{ hours: 18, amount: 353 }
		]
	},
	{
		validFrom: '2026-01-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2026/27',
		tiers: [
			{ hours: 5, amount: 155 },
			{ hours: 12, amount: 236 },
			{ hours: 18, amount: 370 }
		]
	}
];

/** Time spent at the venue per game (the referee's estimate: arrival, game, paperwork). */
export const MINUTES_PER_GAME = 210;

export function mileageFor(date: string, list = mileageRates): MileageRates | undefined {
	return list.find((r) => r.validFrom <= date && (r.validTo === undefined || date < r.validTo));
}

export function mealFor(date: string, list = mealRates): MealRates | undefined {
	return list.filter((r) => r.validFrom <= date).at(-1);
}

/** Meal allowance for a trip of `hours`: the highest tier reached, 0 under 5 hours. */
export function mealAmount(rates: MealRates, hours: number): number {
	return rates.tiers.filter((t) => hours >= t.hours).at(-1)?.amount ?? 0;
}
