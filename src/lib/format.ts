const dateTime = new Intl.DateTimeFormat('cs-CZ', {
	weekday: 'short',
	day: 'numeric',
	month: 'numeric',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'Europe/Prague'
});

const dateOnly = new Intl.DateTimeFormat('cs-CZ', {
	weekday: 'short',
	day: 'numeric',
	month: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});

const number = new Intl.NumberFormat('cs-CZ');

/** Start of a game in Europe/Prague; falls back to the bare date when the time is unknown. */
export function formatGameStart(startsAt: Date | string | null, scheduledDate: string | null) {
	if (startsAt) return dateTime.format(new Date(startsAt));
	if (scheduledDate) return dateOnly.format(new Date(`${scheduledDate}T00:00:00Z`));
	return 'termín neurčen';
}

export function formatDate(isoDate: string | null) {
	return isoDate ? dateOnly.format(new Date(`${isoDate}T00:00:00Z`)) : '—';
}

export function formatNumber(n: number) {
	return number.format(n);
}

export function seasonName(startYear: number | null) {
	return startYear === null ? '' : `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}
