import { describe, expect, it } from 'vitest';
import { ageGroup, classifyCompetition, type CompetitionInfo } from './classify';
import { gameFee, type FeeGame } from './index';
import { scheduleFor, schedules } from './schedules';

const comp = (over: Partial<CompetitionInfo>): CompetitionInfo => ({
	areaId: 0,
	isFemale: false,
	categoryName: null,
	leagueName: null,
	competitionName: null,
	phaseName: null,
	round: null,
	...over
});

const game = (over: Partial<FeeGame>): FeeGame => ({
	...comp({}),
	role: 'referee1',
	date: '2026-10-10',
	refereeCount: 2,
	played: true,
	...over
});

describe('ageGroup', () => {
	it.each([
		['muži U19', null, 19],
		['junioři U19', 'extraliga', 19],
		['kadetky U17', null, 17],
		['žáci U15', null, 15],
		['mladší žákyně U14', null, 14],
		['starší minižáci U13', null, 13],
		['mladší minižačky', null, 12],
		['muži', '1. liga', 0],
		['ženy', null, 0],
		[null, 'Přebor U17M', 17],
		[null, 'Přebor A', null]
	])('%s / %s → %s', (category, name, expected) => {
		expect(ageGroup(category, name)).toBe(expected);
	});
});

describe('classifyCompetition: national (area 0)', () => {
	it.each<[Partial<CompetitionInfo>, string | null]>([
		[
			{ categoryName: 'muži', leagueName: '1. liga', competitionName: '1. liga mužů' },
			'cbf.m.liga1'
		],
		[
			{ categoryName: 'muži', leagueName: '2. liga', competitionName: '2. liga mužů' },
			'cbf.m.liga2'
		],
		[
			{
				isFemale: true,
				categoryName: 'ženy',
				leagueName: '1. liga',
				competitionName: '1. liga žen'
			},
			'cbf.z.liga1'
		],
		[{ categoryName: 'muži', leagueName: 'NBL', competitionName: 'Maxa NBL' }, null],
		[
			{ isFemale: true, categoryName: 'ženy', leagueName: 'ŽBL', competitionName: 'Chance ŽBL' },
			null
		],
		// current names carry the age; older seasons only in the category
		[
			{ categoryName: 'muži U19', leagueName: 'extraliga', competitionName: 'extraliga U19M' },
			'cbf.m.u19.extraliga'
		],
		[
			{ categoryName: 'junioři U19', leagueName: 'extraliga', competitionName: 'extraliga' },
			'cbf.m.u19.extraliga'
		],
		[
			{
				isFemale: true,
				categoryName: 'ženy U17',
				leagueName: 'liga',
				competitionName: 'celostátní liga U17Ž'
			},
			'cbf.z.u17.liga'
		],
		[{ categoryName: 'kadeti U17', leagueName: 'liga', competitionName: 'liga' }, 'cbf.m.u17.liga'],
		[
			{
				categoryName: 'muži U15',
				leagueName: 'žákovská liga',
				competitionName: 'žákovská liga U15M',
				phaseName: 'skupina A'
			},
			'cbf.m.u15.ostatni'
		],
		[
			{
				categoryName: 'muži U14',
				leagueName: 'žákovská liga',
				competitionName: 'žákovská liga U14M',
				phaseName: 'Extraliga'
			},
			'cbf.m.u14.extraliga'
		],
		[
			{
				categoryName: 'muži U19',
				leagueName: 'nadregionální soutěž',
				competitionName: 'nadregionální liga U19M'
			},
			'nrl.dorost'
		],
		[
			{
				isFemale: true,
				categoryName: 'ženy U15',
				leagueName: 'nadregionální soutěž',
				competitionName: 'nadregionální liga U15Ž'
			},
			'nrl.zactvo'
		],
		[
			{
				categoryName: 'muži U13',
				leagueName: 'mistrovství ČR',
				competitionName: 'mistrovství ČR U13M'
			},
			null
		],
		[
			{ categoryName: 'Repre Muži', leagueName: 'Mistrovství Evropy', competitionName: 'Divize A' },
			null
		]
	])('%o → %s', (info, key) => {
		expect(classifyCompetition(comp(info)).key).toBe(key);
	});

	it('marks qualifications as assumptions', () => {
		const c = classifyCompetition(
			comp({
				categoryName: 'muži U19',
				leagueName: 'kvalifikace o extraligu',
				competitionName: 'kvalifikace o extraligu U19M'
			})
		);
		expect(c).toMatchObject({ key: 'cbf.m.u19.liga', assumption: expect.any(String) });
	});

	it('reads Czech cup rounds from phases and round numbers', () => {
		const cup = (phaseName: string | null, round: string | null, isFemale = false) =>
			classifyCompetition(
				comp({
					isFemale,
					categoryName: isFemale ? 'ženy' : 'muži',
					leagueName: 'Český pohár',
					competitionName: 'Český pohár',
					phaseName,
					round
				})
			).key;
		expect(cup('Český pohár mužů', '2')).toBe('cp.m.kolo2');
		expect(cup('IV. kolo (osmifinále)', null)).toBe('cp.m.osmifinale');
		expect(cup('čtvrtfinále', null)).toBe('cp.m.ctvrtfinale');
		expect(cup('Final4 – o 3. místo', null, true)).toBe('cp.z.semifinale');
		expect(cup('finále', null, true)).toBe('cp.z.finale');
		expect(cup(null, null)).toBe('cp.m.kolo1');
	});
});

describe('classifyCompetition: Praha (area 1)', () => {
	it.each<[Partial<CompetitionInfo>, string]>([
		[{ categoryName: 'muži', competitionName: 'Přebor A' }, 'praha.preborA'],
		[{ categoryName: 'muži', competitionName: 'Přebor B' }, 'praha.preborB'],
		[{ categoryName: 'muži', competitionName: '1.třída' }, 'praha.t1'],
		[{ categoryName: 'muži', competitionName: '2.třída C' }, 'praha.t2'],
		[{ categoryName: 'muži', competitionName: '3.třída A' }, 'praha.ostatni'],
		[{ isFemale: true, categoryName: 'ženy', competitionName: 'Přebor žen' }, 'praha.t1'],
		[{ isFemale: true, categoryName: 'ženy', competitionName: '1.třída' }, 'praha.t2'],
		[{ isFemale: true, categoryName: 'ženy', competitionName: '2.třída' }, 'praha.ostatni'],
		[{ categoryName: 'muži U19', competitionName: 'Přebor U19M' }, 'praha.u19u17'],
		[{ categoryName: 'muži U15', competitionName: 'Přebor U15M' }, 'praha.u15u14'],
		[
			{ categoryName: 'muži U12', competitionName: 'Přebor U12M', phaseName: 'Kvalifikace A' },
			'praha.mini'
		],
		[{ categoryName: 'mix U11', competitionName: 'U11 3x3 mix' }, 'praha.u11_3x3'],
		[{ categoryName: 'muži', competitionName: 'Pohár mužů PBS', round: '1' }, 'praha.pohar.kolo12'],
		[{ categoryName: 'muži', competitionName: 'Pohár mužů PBS', round: '3' }, 'praha.pohar.kolo3'],
		[
			{ categoryName: 'muži', competitionName: 'Pohár mužů PBS', phaseName: 'Finále' },
			'praha.pohar.sf'
		]
	])('%o → %s', (info, key) => {
		expect(classifyCompetition(comp({ areaId: 1, ...info })).key).toBe(key);
	});

	it('leaves other areas without a schedule', () => {
		expect(
			classifyCompetition(comp({ areaId: 7, competitionName: '1.Jihomoravská liga' }))
		).toEqual({
			key: null,
			reason: expect.any(String)
		});
	});
});

describe('schedules', () => {
	it('do not overlap within a scope', () => {
		for (const scope of ['cbf', 'cp', 'praha'] as const) {
			const list = schedules.filter((s) => s.scope === scope);
			for (const a of list) {
				for (const b of list) {
					if (a === b) continue;
					const overlap =
						a.validFrom < (b.validTo ?? '9999') && b.validFrom < (a.validTo ?? '9999');
					expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
				}
			}
		}
	});

	it('match the published overviews', () => {
		const rate = (scope: 'cbf' | 'cp' | 'praha', date: string, key: string) =>
			scheduleFor(scope, date)?.rates[key as never];
		// Praha 2023/24, 2025/26, 2026/27 (aktualizace 30. 9. 2026)
		expect([800, 700, 600, 500, 400, 500, 400, 300].map(String)).toEqual(
			['preborA', 'preborB', 't1', 't2', 'ostatni', 'u19u17', 'u15u14', 'mini'].map((k) =>
				String(rate('praha', '2023-10-01', `praha.${k}`))
			)
		);
		expect(rate('praha', '2025-10-01', 'praha.preborA')).toBe(900);
		expect(rate('praha', '2025-10-01', 'praha.mini')).toBe(300);
		expect(rate('praha', '2025-10-01', 'praha.pohar.sf')).toBe(900);
		expect(rate('praha', '2026-10-01', 'praha.preborA')).toBe(1000);
		expect(rate('praha', '2026-10-01', 'praha.ostatni')).toBe(600);
		expect(rate('praha', '2026-10-01', 'praha.mini')).toBe(400);
		expect(rate('praha', '2026-10-01', 'praha.u11_3x3')).toBe(200);
		expect(rate('praha', '2026-10-01', 'praha.pohar.kolo12')).toBe(800);
		// Praha 2017–2020 as reported: mini 300, 3. třída 400, +100 per level
		expect(rate('praha', '2018-03-01', 'praha.ostatni')).toBe(400);
		expect(rate('praha', '2018-03-01', 'praha.preborA')).toBe(800);
		expect(rate('praha', '2018-03-01', 'praha.mini')).toBe(300);
		// ČBF: until 31. 12. 2026 and the raise from 1. 1. 2027
		expect(rate('cbf', '2026-12-31', 'cbf.m.liga1')).toBe(1750);
		expect(rate('cbf', '2027-01-01', 'cbf.m.liga1')).toBe(1950);
		expect(rate('cbf', '2027-01-01', 'cbf.z.u19.extraliga')).toBe(950);
		expect(rate('cbf', '2027-01-01', 'nrl.dorost')).toBe(600);
		expect(rate('cp', '2026-10-01', 'cp.z.kolo3')).toBe(2000);
		expect(rate('cp', '2024-10-01', 'cp.m.kolo1')).toBeUndefined();
		expect(scheduleFor('praha', '2016-10-01')).toBeUndefined();
	});
});

describe('gameFee', () => {
	const prebor = { areaId: 1, categoryName: 'muži', competitionName: 'Přebor A' };

	it('uses the schedule in force on the game date', () => {
		expect(gameFee(game({ ...prebor, date: '2026-10-10' }))).toMatchObject({
			amount: 1000,
			provenance: 'document'
		});
		expect(gameFee(game({ ...prebor, date: '2019-02-10' }))).toMatchObject({
			amount: 800,
			provenance: 'reported'
		});
		expect(gameFee(game({ ...prebor, date: '2021-02-10' }))).toMatchObject({
			amount: 800,
			provenance: 'assumed'
		});
		expect(gameFee(game({ ...prebor, date: '2015-02-10' }))).toMatchObject({ amount: null });
	});

	it('pays 1.5× to a single referee of a played game, except minižactvo', () => {
		expect(gameFee(game({ ...prebor, refereeCount: 1 }))).toMatchObject({
			amount: 1500,
			singleReferee: true
		});
		expect(gameFee(game({ ...prebor, refereeCount: 1, played: false }))).toMatchObject({
			amount: 1000
		});
		const mini = { areaId: 1, categoryName: 'muži U12', competitionName: 'Přebor U12M' };
		expect(gameFee(game({ ...mini, refereeCount: 1 }))).toMatchObject({
			amount: 400,
			singleReferee: false
		});
	});

	it('has no fee for commissioners', () => {
		expect(gameFee(game({ ...prebor, role: 'commissioner' }))).toMatchObject({ amount: null });
	});

	it('switches to the raised national fees on 1. 1. 2027', () => {
		const u19 = {
			categoryName: 'muži U19',
			leagueName: 'extraliga',
			competitionName: 'extraliga U19M'
		};
		expect(gameFee(game({ ...u19, date: '2026-12-20' })).amount).toBe(1150);
		expect(gameFee(game({ ...u19, date: '2027-01-09' })).amount).toBe(1300);
	});
});
