/**
 * Referee fee schedules ("přehled odměn rozhodčích", PDR 0002). Only the per-game fee for leading
 * a game is modelled; travel costs, meal allowance and weekday supplements depend on the
 * referee's home and are left out. A schedule applies to games dated in [validFrom, validTo).
 */

export type Provenance = 'document' | 'reported' | 'assumed';

type Gender = 'm' | 'z';
type YouthLevel =
	| 'u19.extraliga'
	| 'u19.liga'
	| 'u17.extraliga'
	| 'u17.liga'
	| 'u15.extraliga'
	| 'u15.ostatni'
	| 'u14.extraliga'
	| 'u14.ostatni';

export type CbfKey =
	`cbf.${Gender}.${'liga1' | 'liga2' | YouthLevel}` | 'nrl.zactvo' | 'nrl.dorost';
export type CupKey =
	| `cp.m.${'kolo1' | 'kolo2' | 'kolo3' | 'osmifinale' | 'ctvrtfinale' | 'semifinale' | 'finale'}`
	| `cp.z.${'kolo1' | 'kolo2' | 'kolo3' | 'ctvrtfinale' | 'semifinale' | 'finale'}`;
export type PragueKey =
	| 'praha.preborA'
	| 'praha.preborB'
	| 'praha.t1'
	| 'praha.t2'
	| 'praha.ostatni'
	| 'praha.u19u17'
	| 'praha.u15u14'
	| 'praha.mini'
	| 'praha.u11_3x3'
	| 'praha.pohar.kolo12'
	| 'praha.pohar.kolo3'
	| 'praha.pohar.sf';
export type FeeKey = CbfKey | CupKey | PragueKey;

export type Scope = 'cbf' | 'cp' | 'praha';

export interface FeeSchedule {
	id: string;
	scope: Scope;
	validFrom: string;
	validTo?: string;
	provenance: Provenance;
	source: string;
	/** fee multiplier when a single referee leads the game ("1,5 násobek odměny") */
	singleReferee?: { multiplier: number; except?: FeeKey[] };
	rates: Partial<Record<FeeKey, number>>;
}

export function scopeOf(key: FeeKey): Scope {
	if (key.startsWith('cp.')) return 'cp';
	if (key.startsWith('praha.')) return 'praha';
	return 'cbf';
}

export const feeLabels: Record<FeeKey, string> = {
	'cbf.m.liga1': 'I. liga mužů',
	'cbf.m.liga2': 'II. liga mužů',
	'cbf.z.liga1': 'I. liga žen',
	'cbf.z.liga2': 'II. liga žen',
	'cbf.m.u19.extraliga': 'extraliga U19 chlapci',
	'cbf.m.u19.liga': 'celostátní liga U19 chlapci',
	'cbf.m.u17.extraliga': 'extraliga U17 chlapci',
	'cbf.m.u17.liga': 'celostátní liga U17 chlapci',
	'cbf.m.u15.extraliga': 'U15 extraliga chlapci',
	'cbf.m.u15.ostatni': 'U15 ostatní fáze chlapci',
	'cbf.m.u14.extraliga': 'U14 extraliga chlapci',
	'cbf.m.u14.ostatni': 'U14 ostatní fáze chlapci',
	'cbf.z.u19.extraliga': 'extraliga U19 dívky',
	'cbf.z.u19.liga': 'celostátní liga U19 dívky',
	'cbf.z.u17.extraliga': 'extraliga U17 dívky',
	'cbf.z.u17.liga': 'celostátní liga U17 dívky',
	'cbf.z.u15.extraliga': 'U15 extraliga dívky',
	'cbf.z.u15.ostatni': 'U15 ostatní fáze dívky',
	'cbf.z.u14.extraliga': 'U14 extraliga dívky',
	'cbf.z.u14.ostatni': 'U14 ostatní fáze dívky',
	'nrl.zactvo': 'NRL žactvo (U14, U15)',
	'nrl.dorost': 'NRL dorost (U17, U19)',
	'cp.m.kolo1': 'ČP mužů, I. kolo',
	'cp.m.kolo2': 'ČP mužů, II. kolo',
	'cp.m.kolo3': 'ČP mužů, III. kolo',
	'cp.m.osmifinale': 'ČP mužů, osmifinále',
	'cp.m.ctvrtfinale': 'ČP mužů, čtvrtfinále',
	'cp.m.semifinale': 'ČP mužů, semifinále a o 3. místo',
	'cp.m.finale': 'ČP mužů, finále',
	'cp.z.kolo1': 'ČP žen, 1. kolo',
	'cp.z.kolo2': 'ČP žen, 2. kolo',
	'cp.z.kolo3': 'ČP žen, 3. kolo',
	'cp.z.ctvrtfinale': 'ČP žen, čtvrtfinále',
	'cp.z.semifinale': 'ČP žen, semifinále a o 3. místo',
	'cp.z.finale': 'ČP žen, finále',
	'praha.preborA': 'Praha, Přebor A mužů',
	'praha.preborB': 'Praha, Přebor B mužů',
	'praha.t1': 'Praha, Přebor žen / 1. třída mužů',
	'praha.t2': 'Praha, 2. třída mužů / 1. třída žen',
	'praha.ostatni': 'Praha, ostatní soutěže dospělých',
	'praha.u19u17': 'Praha, U19 a U17',
	'praha.u15u14': 'Praha, U15 a U14',
	'praha.mini': 'Praha, minižactvo',
	'praha.u11_3x3': 'Praha, U11 3x3 mix',
	'praha.pohar.kolo12': 'Pražský pohár, předkolo, 1. a 2. kolo',
	'praha.pohar.kolo3': 'Pražský pohár, 3. a další kola',
	'praha.pohar.sf': 'Pražský pohár, semifinále a finále'
};

/** ČBF national leagues 2023/24 – 2026 (same in the 2023/24, 2025/26 and 2026/27 overviews). */
const cbf2023: Partial<Record<FeeKey, number>> = {
	'cbf.m.liga1': 1750,
	'cbf.m.liga2': 1050,
	'cbf.z.liga1': 1050,
	'cbf.z.liga2': 750,
	'cbf.m.u19.extraliga': 1150,
	'cbf.m.u19.liga': 800,
	'cbf.m.u17.extraliga': 900,
	'cbf.m.u17.liga': 700,
	'cbf.m.u15.extraliga': 700,
	'cbf.m.u15.ostatni': 600,
	'cbf.m.u14.extraliga': 600,
	'cbf.m.u14.ostatni': 550,
	'cbf.z.u19.extraliga': 850,
	'cbf.z.u19.liga': 700,
	'cbf.z.u17.extraliga': 800,
	'cbf.z.u17.liga': 700,
	'cbf.z.u15.extraliga': 700,
	'cbf.z.u15.ostatni': 600,
	'cbf.z.u14.extraliga': 600,
	'cbf.z.u14.ostatni': 550,
	'nrl.zactvo': 500,
	'nrl.dorost': 600
};

/** Raise approved by the ČBF board on 23. 9. 2026 (minutes of the ČABR board of 22. 9. 2026). */
const cbf2027: Partial<Record<FeeKey, number>> = {
	...cbf2023,
	'cbf.m.liga1': 1950,
	'cbf.m.liga2': 1200,
	'cbf.z.liga1': 1200,
	'cbf.z.liga2': 850,
	'cbf.m.u19.extraliga': 1300,
	'cbf.m.u19.liga': 950,
	'cbf.m.u17.extraliga': 1000,
	'cbf.m.u17.liga': 750,
	'cbf.m.u15.extraliga': 750,
	'cbf.m.u15.ostatni': 650,
	'cbf.m.u14.extraliga': 650,
	'cbf.m.u14.ostatni': 600,
	'cbf.z.u19.extraliga': 950,
	'cbf.z.u19.liga': 800,
	'cbf.z.u17.extraliga': 900,
	'cbf.z.u17.liga': 750,
	'cbf.z.u15.extraliga': 750,
	'cbf.z.u15.ostatni': 650,
	'cbf.z.u14.extraliga': 650,
	'cbf.z.u14.ostatni': 600
};

/** Prague fees as a ladder: each adult level +100 Kč above the next (the pattern since 2017). */
function pragueLadder(base: {
	ostatni: number;
	mini: number;
	u11_3x3: number;
}): Partial<Record<FeeKey, number>> {
	const o = base.ostatni;
	return {
		'praha.preborA': o + 400,
		'praha.preborB': o + 300,
		'praha.t1': o + 200,
		'praha.t2': o + 100,
		'praha.ostatni': o,
		'praha.u19u17': o + 100,
		'praha.u15u14': o,
		'praha.mini': base.mini,
		'praha.u11_3x3': base.u11_3x3,
		'praha.pohar.kolo12': o + 200,
		'praha.pohar.kolo3': o + 300,
		'praha.pohar.sf': o + 400
	};
}

const pragueSingle = { multiplier: 1.5, except: ['praha.mini', 'praha.u11_3x3'] as FeeKey[] };
const cbfSingle = { multiplier: 1.5 };

export const schedules: FeeSchedule[] = [
	// ČBF national leagues and NRL
	{
		id: 'cbf-2017',
		scope: 'cbf',
		validFrom: '2017-07-01',
		validTo: '2023-07-01',
		provenance: 'assumed',
		source: 'předpoklad: stejné jako 2023/24',
		rates: cbf2023
	},
	{
		id: 'cbf-2023',
		scope: 'cbf',
		validFrom: '2023-07-01',
		validTo: '2025-07-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2023/24 (2024/25 odvozeno, 2023/24 i 2025/26 jsou shodné)',
		rates: cbf2023
	},
	{
		id: 'cbf-2025',
		scope: 'cbf',
		validFrom: '2025-07-01',
		validTo: '2027-01-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2025/26 a 2026/27',
		singleReferee: cbfSingle,
		rates: cbf2023
	},
	{
		id: 'cbf-2027',
		scope: 'cbf',
		validFrom: '2027-01-01',
		provenance: 'document',
		source: 'Zápis VV ČABR 22. 9. 2026: zvýšení od 1. 1. 2027',
		singleReferee: cbfSingle,
		rates: cbf2027
	},

	// Český pohár (2023/24 refers to an unpublished cup rulebook)
	{
		id: 'cp-2025',
		scope: 'cp',
		validFrom: '2025-07-01',
		validTo: '2026-07-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2025/26',
		rates: {
			'cp.m.kolo1': 900,
			'cp.m.kolo2': 1000,
			'cp.m.kolo3': 1500,
			'cp.m.osmifinale': 3000,
			'cp.m.ctvrtfinale': 5000,
			'cp.m.semifinale': 5500,
			'cp.m.finale': 6000
		}
	},
	{
		id: 'cp-2026',
		scope: 'cp',
		validFrom: '2026-07-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2026/27',
		rates: {
			'cp.m.kolo1': 900,
			'cp.m.kolo2': 1000,
			'cp.m.kolo3': 1500,
			'cp.m.osmifinale': 3000,
			'cp.m.ctvrtfinale': 5000,
			'cp.m.semifinale': 5500,
			'cp.m.finale': 6000,
			'cp.z.kolo1': 900,
			'cp.z.kolo2': 1200,
			'cp.z.kolo3': 2000,
			'cp.z.ctvrtfinale': 2000,
			'cp.z.semifinale': 3000,
			'cp.z.finale': 3000
		}
	},

	// Praha
	{
		id: 'praha-2017',
		scope: 'praha',
		validFrom: '2017-07-01',
		validTo: '2020-07-01',
		provenance: 'reported',
		source: 'podle rozhodčího: minižactvo 300, 3. třída 400, každá vyšší soutěž +100',
		singleReferee: pragueSingle,
		rates: pragueLadder({ ostatni: 400, mini: 300, u11_3x3: 150 })
	},
	{
		id: 'praha-2020',
		scope: 'praha',
		validFrom: '2020-07-01',
		validTo: '2023-07-01',
		provenance: 'assumed',
		source: 'předpoklad: stejné jako 2017–2020 a 2023/24',
		singleReferee: pragueSingle,
		rates: pragueLadder({ ostatni: 400, mini: 300, u11_3x3: 150 })
	},
	{
		id: 'praha-2023',
		scope: 'praha',
		validFrom: '2023-07-01',
		validTo: '2024-07-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2023/24',
		singleReferee: pragueSingle,
		rates: pragueLadder({ ostatni: 400, mini: 300, u11_3x3: 150 })
	},
	{
		id: 'praha-2024',
		scope: 'praha',
		validFrom: '2024-07-01',
		validTo: '2025-07-01',
		provenance: 'assumed',
		source: 'předpoklad: stejné jako 2023/24',
		singleReferee: pragueSingle,
		rates: pragueLadder({ ostatni: 400, mini: 300, u11_3x3: 150 })
	},
	{
		id: 'praha-2025',
		scope: 'praha',
		validFrom: '2025-07-01',
		validTo: '2026-07-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2025/26',
		singleReferee: pragueSingle,
		rates: pragueLadder({ ostatni: 500, mini: 300, u11_3x3: 150 })
	},
	{
		id: 'praha-2026',
		scope: 'praha',
		validFrom: '2026-07-01',
		provenance: 'document',
		source: 'Přehled odměn rozhodčích 2026/27 (aktualizace 30. 9. 2026)',
		singleReferee: pragueSingle,
		rates: pragueLadder({ ostatni: 600, mini: 400, u11_3x3: 200 })
	}
];

/** The schedule of `scope` in force on `date` (YYYY-MM-DD). */
export function scheduleFor(
	scope: Scope,
	date: string,
	list: FeeSchedule[] = schedules
): FeeSchedule | undefined {
	return list.find(
		(s) => s.scope === scope && s.validFrom <= date && (s.validTo === undefined || date < s.validTo)
	);
}
