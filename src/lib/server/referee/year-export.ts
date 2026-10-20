/**
 * Calendar-year export for the tax return (PDR 0004): one CSV row per refereed game played in the
 * year (fee from the schedules or as entered), per own game, and per game day with allowances.
 * Semicolons, decimal commas and a BOM, so Czech Excel opens it as is.
 */
import type { DayRow } from '../travel/summary';
import type { FeeRow } from './earnings';
import { ownGameRoleNames, type OwnGame } from './own-games';
import { roleNames } from './queries';

const HEADER = [
	'Typ',
	'Datum',
	'Soutěž / akce',
	'Kategorie',
	'Zápas',
	'Role',
	'Počet zápasů',
	'Odměna Kč',
	'Cestovné Kč',
	'Stravné Kč',
	'Všední den Kč',
	'Celkem Kč',
	'Odhad',
	'Poznámka'
];

const cell = (v: string | number | null | undefined) => {
	if (v === null || v === undefined) return '';
	const s = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v;
	return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

interface Line {
	date: string;
	values: (string | number | null)[];
}

export function yearCsv(
	year: number,
	fees: FeeRow[],
	days: DayRow[],
	own: OwnGame[],
	today: string
): string {
	const inYear = (date: string | null): date is string =>
		date !== null && date.startsWith(`${year}-`) && date <= today;
	const lines: Line[] = [];
	let fee = 0;
	let allowances = 0;

	for (const r of fees) {
		if (!r.played || !inYear(r.date)) continue;
		const amount = r.fee.amount;
		fee += amount ?? 0;
		lines.push({
			date: r.date,
			values: [
				'odměna ČBF',
				r.date,
				r.competitionName,
				r.categoryName,
				[r.homeTeam, r.awayTeam].filter(Boolean).join(' – ') || null,
				roleNames[r.role] ?? r.role,
				1,
				amount,
				null,
				null,
				null,
				amount,
				amount !== null && r.fee.provenance === 'assumed' ? 'ano' : null,
				amount === null ? r.fee.reason : r.fee.label
			]
		});
	}

	for (const g of own) {
		if (!inYear(g.date)) continue;
		fee += g.fee ?? 0;
		lines.push({
			date: g.date,
			values: [
				'vlastní zápas',
				g.date,
				g.title,
				null,
				g.place,
				ownGameRoleNames[g.role],
				g.games,
				g.fee,
				null,
				null,
				null,
				g.fee,
				null,
				g.note
			]
		});
	}

	for (const d of days) {
		const a = d.allowance;
		if (!a || !inYear(d.day.date) || a.total === 0) continue;
		allowances += a.total;
		const km = a.km.alone + a.km.shared;
		lines.push({
			date: d.day.date,
			values: [
				'náhrady',
				d.day.date,
				[...new Set(d.day.games.map((g) => g.competitionName).filter(Boolean))].join(', '),
				null,
				null,
				null,
				d.day.games.length,
				null,
				a.travel,
				a.meal,
				a.weekday,
				a.total,
				a.estimated ? 'ano' : null,
				[km ? `${String(Math.round(km * 10) / 10).replace('.', ',')} km` : null, ...a.notes]
					.filter(Boolean)
					.join('; ') || null
			]
		});
	}

	lines.sort((a, b) => a.date.localeCompare(b.date));
	const rows = [
		HEADER,
		...lines.map((l) => l.values),
		[],
		['součet odměn', null, null, null, null, null, null, fee, null, null, null, fee],
		['součet náhrad', null, null, null, null, null, null, null, null, null, null, allowances]
	];
	return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
