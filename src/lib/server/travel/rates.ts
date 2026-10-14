/**
 * Travel and meal allowances (PDR 0003), from the "Náhrada cestovních výdajů a stravné" chapter
 * of the fee overviews. Mileage and the weekday supplement follow the season's overview; the
 * meal allowance follows the MPSV decree in force on the trip date.
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

/**
 * Minimum domestic meal allowance for private-sector employers (§ 163 zákoníku práce), as the
 * overviews quote it: MPSV decrees per calendar year, mid-2022 raise included.
 */
export const mealRates: MealRates[] = [
	{
		validFrom: '2017-01-01',
		provenance: 'document',
		source: 'vyhláška MPSV č. 440/2016 Sb.',
		tiers: [
			{ hours: 5, amount: 72 },
			{ hours: 12, amount: 109 },
			{ hours: 18, amount: 171 }
		]
	},
	{
		validFrom: '2018-01-01',
		provenance: 'document',
		source: 'vyhláška MPSV č. 463/2017 Sb.',
		tiers: [
			{ hours: 5, amount: 78 },
			{ hours: 12, amount: 119 },
			{ hours: 18, amount: 186 }
		]
	},
	{
		validFrom: '2019-01-01',
		provenance: 'document',
		source: 'vyhláška MPSV č. 333/2018 Sb.',
		tiers: [
			{ hours: 5, amount: 82 },
			{ hours: 12, amount: 124 },
			{ hours: 18, amount: 195 }
		]
	},
	{
		validFrom: '2020-01-01',
		provenance: 'document',
		source: 'vyhláška MPSV č. 358/2019 Sb.',
		tiers: [
			{ hours: 5, amount: 87 },
			{ hours: 12, amount: 131 },
			{ hours: 18, amount: 206 }
		]
	},
	{
		validFrom: '2021-01-01',
		provenance: 'document',
		source: 'vyhláška MPSV č. 589/2020 Sb.',
		tiers: [
			{ hours: 5, amount: 91 },
			{ hours: 12, amount: 138 },
			{ hours: 18, amount: 217 }
		]
	},
	{
		validFrom: '2022-01-01',
		provenance: 'document',
		source: 'vyhláška MPSV č. 511/2021 Sb.',
		tiers: [
			{ hours: 5, amount: 99 },
			{ hours: 12, amount: 151 },
			{ hours: 18, amount: 237 }
		]
	},
	{
		validFrom: '2022-08-20',
		provenance: 'document',
		source: 'vyhláška MPSV č. 237/2022 Sb. (od 20. 8. 2022)',
		tiers: [
			{ hours: 5, amount: 120 },
			{ hours: 12, amount: 181 },
			{ hours: 18, amount: 284 }
		]
	},
	{
		validFrom: '2023-01-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2023/24 (vyhláška pro rok 2023)',
		tiers: [
			{ hours: 5, amount: 129 },
			{ hours: 12, amount: 196 },
			{ hours: 18, amount: 307 }
		]
	},
	{
		validFrom: '2024-01-01',
		provenance: 'document',
		source: 'vyhláška MPSV č. 398/2023 Sb.',
		tiers: [
			{ hours: 5, amount: 140 },
			{ hours: 12, amount: 212 },
			{ hours: 18, amount: 333 }
		]
	},
	{
		validFrom: '2025-01-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2025/26 (vyhláška pro rok 2025)',
		tiers: [
			{ hours: 5, amount: 148 },
			{ hours: 12, amount: 225 },
			{ hours: 18, amount: 353 }
		]
	},
	{
		validFrom: '2026-01-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2026/27, vyhláška MPSV č. 573/2025 Sb.',
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
	// § 163 ZP: the first tier from 5 hours inclusive, the higher ones only above 12 and 18 hours
	return (
		rates.tiers.filter((t, i) => (i === 0 ? hours >= t.hours : hours > t.hours)).at(-1)?.amount ?? 0
	);
}
