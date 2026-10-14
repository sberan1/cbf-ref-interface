/** Czech public holidays (zákon č. 245/2000 Sb.) and the weekday test of the weekday supplement. */

const FIXED: [string, string][] = [
	['01-01', 'Den obnovy samostatného českého státu, Nový rok'],
	['05-01', 'Svátek práce'],
	['05-08', 'Den vítězství'],
	['07-05', 'Den slovanských věrozvěstů Cyrila a Metoděje'],
	['07-06', 'Den upálení mistra Jana Husa'],
	['09-28', 'Den české státnosti'],
	['10-28', 'Den vzniku samostatného československého státu'],
	['11-17', 'Den boje za svobodu a demokracii'],
	['12-24', 'Štědrý den'],
	['12-25', '1. svátek vánoční'],
	['12-26', '2. svátek vánoční']
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Easter Sunday (Gregorian, anonymous algorithm) as a UTC date. */
export function easterSunday(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return new Date(Date.UTC(year, month - 1, day));
}

const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const cache = new Map<number, Map<string, string>>();

export function holidays(year: number): Map<string, string> {
	let map = cache.get(year);
	if (map) return map;
	map = new Map(FIXED.map(([md, name]) => [`${year}-${md}`, name]));
	const easter = easterSunday(year);
	const shift = (days: number) => iso(new Date(easter.getTime() + days * 86_400_000));
	if (year >= 2016) map.set(shift(-2), 'Velký pátek');
	map.set(shift(1), 'Velikonoční pondělí');
	cache.set(year, map);
	return map;
}

/** Name of the public holiday on `date` (YYYY-MM-DD), if any. */
export function holidayName(date: string): string | undefined {
	return holidays(Number(date.slice(0, 4))).get(date);
}

export function isWeekend(date: string): boolean {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 || day === 6;
}

/** Monday–Friday and not a public holiday. */
export function isWorkday(date: string): boolean {
	return !isWeekend(date) && holidayName(date) === undefined;
}
