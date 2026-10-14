/**
 * Maps a ČBF competition (area, gender, category, name, phase, round) to the line of the fee
 * schedule it is paid by. Names changed over the seasons ("extraliga" with the age only in the
 * category vs. "extraliga U19M"), so the age comes from the category name first.
 */
import { foldText } from '../referee/text';
import type { CupKey, FeeKey } from './schedules';

export interface CompetitionInfo {
	areaId: number | null;
	isFemale: boolean | null;
	categoryName: string | null;
	leagueName: string | null;
	competitionName: string | null;
	phaseName: string | null;
	round: string | null;
}

export type Classification = { key: FeeKey; assumption?: string } | { key: null; reason: string };

/** Age group: 19, 17, 15, 14 … for youth, 0 for adults, null when unknown. Mini → 12 or below. */
export function ageGroup(
	categoryName: string | null,
	competitionName: string | null
): number | null {
	for (const text of [categoryName, competitionName]) {
		if (!text) continue;
		const t = foldText(text);
		const u = /\bu\s?(\d{1,2})/.exec(t);
		if (u) return Number(u[1]);
		if (/minizac|minizak|minizact|pripravk|\bmini\b/.test(t)) return 12;
		if (/junior/.test(t)) return 19;
		if (/kadet/.test(t)) return 17;
		if (/starsi zac|starsi zak|starsi zakyne/.test(t)) return 15;
		if (/mladsi zac|mladsi zak|mladsi zakyne/.test(t)) return 14;
		if (/veteran|\bmuzi\b|\bzeny\b|\bmuzu\b|\bzen\b/.test(t)) return 0;
	}
	return null;
}

export function isFemaleCompetition(info: CompetitionInfo): boolean {
	if (info.isFemale !== null) return info.isFemale;
	const t = foldText(`${info.categoryName ?? ''} ${info.competitionName ?? ''}`);
	return /\bzeny\b|\bzen\b|zakyne|divky|kadetky|juniorky|minizakyne|minizacky|u\d{2}z\b/.test(t);
}

const ROUND_NUMBER = /(\d+)\s*\.?\s*kolo|^\s*(\d+)\s*$/;

function roundNumber(info: CompetitionInfo): number | null {
	for (const text of [info.phaseName, info.round]) {
		if (!text) continue;
		const m = ROUND_NUMBER.exec(foldText(text));
		if (m) return Number(m[1] ?? m[2]);
		const roman = /\b(i{1,3}|iv)\.\s*kolo/.exec(foldText(text));
		if (roman) return { i: 1, ii: 2, iii: 3, iv: 4 }[roman[1] as 'i' | 'ii' | 'iii' | 'iv'];
	}
	return null;
}

/** Knockout stage from phase or round names ("čtvrtfinále", "Final4", "o 3. místo"). */
function cupStage(
	info: CompetitionInfo
): 'finale' | 'semifinale' | 'ctvrtfinale' | 'osmifinale' | null {
	const t = foldText(`${info.phaseName ?? ''} ${info.round ?? ''}`);
	if (/osmifinal/.test(t)) return 'osmifinale';
	if (/ctvrtfinal/.test(t)) return 'ctvrtfinale';
	if (/semifinal|o 3\. misto|o treti misto/.test(t)) return 'semifinale';
	// a "Final4" / "Final four" phase holds semifinals and the final: decided by the round below
	if (/final\s*(4|four)/.test(t)) return null;
	if (/finale|final/.test(t)) return 'finale';
	return null;
}

const CUP_ROUNDS = {
	m: ['kolo1', 'kolo2', 'kolo3', 'osmifinale', 'ctvrtfinale', 'semifinale', 'finale'],
	z: ['kolo1', 'kolo2', 'kolo3', 'ctvrtfinale', 'semifinale', 'finale']
} as const;

function czechCup(info: CompetitionInfo, female: boolean): Classification {
	const g = female ? 'z' : 'm';
	const stage = cupStage(info);
	if (stage === 'osmifinale' && female)
		return { key: 'cp.z.kolo3', assumption: 'osmifinále žen jako 3. kolo' };
	if (stage) return { key: `cp.${g}.${stage}` as CupKey };
	const n = roundNumber(info);
	if (/final\s*(4|four)/.test(foldText(`${info.phaseName ?? ''} ${info.round ?? ''}`))) {
		return n !== null && n >= 2
			? { key: `cp.${g}.finale`, assumption: 'Final4: 2. kolo počítáno jako finále' }
			: { key: `cp.${g}.semifinale`, assumption: 'Final4: počítáno jako semifinále' };
	}
	const rounds = CUP_ROUNDS[g];
	if (n !== null && n >= 1 && n <= rounds.length)
		return { key: `cp.${g}.${rounds[n - 1]}` as CupKey };
	return { key: `cp.${g}.kolo1`, assumption: 'kolo poháru neznámé, počítáno jako 1. kolo' };
}

function national(info: CompetitionInfo): Classification {
	const name = foldText(`${info.leagueName ?? ''} | ${info.competitionName ?? ''}`);
	const female = isFemaleCompetition(info);
	const g = female ? 'z' : 'm';
	if (/\bnbl\b|\bzbl\b|zenska basketbalova liga|cewl/.test(name)) {
		return { key: null, reason: 'NBL a ŽBL nejsou v přehledu odměn' };
	}
	if (/pohar/.test(name)) return czechCup(info, female);
	if (
		/3x3|reprez|mistrovstvi (sveta|evropy)|eurobasket|divize [ab]|pripravn|velke (televizni )?finale/.test(
			name
		)
	) {
		return { key: null, reason: 'soutěž mimo přehled odměn' };
	}

	const age = ageGroup(info.categoryName, info.competitionName);
	if (age === 0 || (age === null && /\b[12]\.\s*liga\b|\bi{1,2}\. liga/.test(name))) {
		if (/kvalifikace|baraz/.test(name))
			return { key: null, reason: 'kvalifikace dospělých není v přehledu odměn' };
		if (/\b1\.\s*liga|\bi\. liga/.test(name)) return { key: `cbf.${g}.liga1` };
		if (/\b2\.\s*(n\s+)?liga|\bii\. liga/.test(name)) return { key: `cbf.${g}.liga2` };
		return { key: null, reason: 'celostátní soutěž dospělých mimo přehled odměn' };
	}
	if (age === null) return { key: null, reason: 'neznámá věková kategorie' };

	const dorost = age >= 16;
	const zactvo = age === 14 || age === 15;
	if (!dorost && !zactvo)
		return { key: null, reason: 'celostátní soutěž mládeže mimo přehled odměn' };
	const level = age >= 18 ? 'u19' : age >= 16 ? 'u17' : age === 15 ? 'u15' : 'u14';

	if (/nadregion/.test(name)) return { key: dorost ? 'nrl.dorost' : 'nrl.zactvo' };
	if (/kvalifikace o extraligu/.test(name)) {
		return dorost
			? {
					key: `cbf.${g}.${level as 'u19' | 'u17'}.liga`,
					assumption: 'kvalifikace o extraligu jako celostátní liga'
				}
			: {
					key: `cbf.${g}.${level as 'u15' | 'u14'}.ostatni`,
					assumption: 'kvalifikace jako ostatní fáze'
				};
	}
	if (/kvalifikace o ligu/.test(name)) {
		return dorost
			? { key: 'nrl.dorost', assumption: 'kvalifikace o ligu jako NRL dorost' }
			: {
					key: `cbf.${g}.${level as 'u15' | 'u14'}.ostatni`,
					assumption: 'kvalifikace jako ostatní fáze'
				};
	}
	if (dorost) {
		if (/extraliga/.test(name)) return { key: `cbf.${g}.${level as 'u19' | 'u17'}.extraliga` };
		if (/liga/.test(name)) return { key: `cbf.${g}.${level as 'u19' | 'u17'}.liga` };
	} else if (/liga/.test(name)) {
		// U15/U14: the extraliga is a phase of the "žákovská liga", everything else is "ostatní fáze"
		const phase = foldText(info.phaseName ?? '');
		const sub = /extralig/.test(phase) || /extraliga/.test(name) ? 'extraliga' : 'ostatni';
		return { key: `cbf.${g}.${level as 'u15' | 'u14'}.${sub}` };
	}
	return { key: null, reason: 'celostátní soutěž mládeže mimo přehled odměn' };
}

function prague(info: CompetitionInfo): Classification {
	const name = foldText(info.competitionName ?? '');
	const female = isFemaleCompetition(info);
	const age = ageGroup(info.categoryName, info.competitionName);

	if (age !== null && age > 0) {
		if (/3x3/.test(name) && age <= 11) return { key: 'praha.u11_3x3' };
		if (age >= 16) return { key: 'praha.u19u17' };
		if (age >= 14) return { key: 'praha.u15u14' };
		return { key: 'praha.mini' };
	}

	if (/pohar/.test(name)) {
		const t = foldText(`${info.phaseName ?? ''} ${info.round ?? ''}`);
		if (/semifinal|finale|final/.test(t)) return { key: 'praha.pohar.sf' };
		const n = roundNumber(info);
		if (n !== null) return { key: n >= 3 ? 'praha.pohar.kolo3' : 'praha.pohar.kolo12' };
		if (/predkolo/.test(t)) return { key: 'praha.pohar.kolo12' };
		return { key: 'praha.pohar.kolo12', assumption: 'kolo poháru neznámé, počítáno jako 1. kolo' };
	}

	if (female) {
		if (/prebor/.test(name)) return { key: 'praha.t1' };
		if (/\b1\.?\s*trida/.test(name)) return { key: 'praha.t2' };
		return { key: 'praha.ostatni' };
	}
	if (/prebor\s*a\b/.test(name)) return { key: 'praha.preborA' };
	if (/prebor\s*b\b/.test(name)) return { key: 'praha.preborB' };
	if (/\b1\.?\s*trida/.test(name)) return { key: 'praha.t1' };
	if (/\b2\.?\s*trida/.test(name)) return { key: 'praha.t2' };
	if (/prebor/.test(name))
		return { key: 'praha.preborA', assumption: 'Přebor bez skupiny jako Přebor A' };
	return { key: 'praha.ostatni' };
}

/** ČBF area IDs: 0 = national competitions, 1 = Praha (ADR 0005). */
export function classifyCompetition(info: CompetitionInfo): Classification {
	if (info.areaId === 0) return national(info);
	if (info.areaId === 1) return prague(info);
	if (info.areaId === null) return { key: null, reason: 'neznámá oblast soutěže' };
	return { key: null, reason: 'sazebník této oblasti zatím chybí' };
}
