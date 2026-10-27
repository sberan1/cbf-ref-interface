/**
 * Minimal iCalendar (RFC 5545) writer for the calendar feed (PDR 0006): text escaping, line
 * folding at 75 octets and UTC / all-day dates. Times are written in UTC, so no VTIMEZONE is needed.
 */

export interface IcsEvent {
	uid: string;
	/** timed event; `end` defaults to `start` */
	start?: Date;
	end?: Date;
	/** all-day event (YYYY-MM-DD) when `start` is not set */
	date?: string;
	summary: string;
	description?: string;
	location?: string;
	geo?: { lat: number; lon: number };
	url?: string;
}

export interface IcsCalendar {
	name: string;
	/** stamp of every event (when the feed was generated) */
	now: Date;
	events: IcsEvent[];
}

/** TEXT value escaping (RFC 5545 §3.3.11). */
export function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n');
}

/** Splits a content line into lines of at most 75 octets, never inside a UTF-8 character. */
export function foldLine(line: string): string {
	const encoder = new TextEncoder();
	if (encoder.encode(line).length <= 75) return line;
	const parts: string[] = [];
	let current = '';
	let octets = 0;
	for (const ch of line) {
		const size = encoder.encode(ch).length;
		// continuation lines start with a space, which counts toward their 75 octets
		const limit = parts.length === 0 ? 75 : 74;
		if (octets + size > limit) {
			parts.push(current);
			current = '';
			octets = 0;
		}
		current += ch;
		octets += size;
	}
	parts.push(current);
	return parts.join('\r\n ');
}

export function formatUtc(d: Date): string {
	return d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

const compactDate = (iso: string) => iso.replace(/-/g, '');

function nextDay(iso: string): string {
	return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function eventLines(e: IcsEvent, stamp: string): string[] {
	const lines = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`];
	if (e.start) {
		lines.push(`DTSTART:${formatUtc(e.start)}`, `DTEND:${formatUtc(e.end ?? e.start)}`);
	} else if (e.date) {
		lines.push(
			`DTSTART;VALUE=DATE:${compactDate(e.date)}`,
			`DTEND;VALUE=DATE:${compactDate(nextDay(e.date))}`
		);
	}
	lines.push(`SUMMARY:${escapeText(e.summary)}`);
	if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
	if (e.geo) lines.push(`GEO:${e.geo.lat};${e.geo.lon}`);
	if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
	if (e.url) lines.push(`URL:${e.url}`);
	lines.push('END:VEVENT');
	return lines;
}

export function renderCalendar(cal: IcsCalendar): string {
	const stamp = formatUtc(cal.now);
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//cbf-ref-interface//Rozhodci CBF//CS',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${escapeText(cal.name)}`,
		'X-WR-TIMEZONE:Europe/Prague',
		// how often clients should poll; Google Calendar ignores it and refreshes on its own schedule
		'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
		'X-PUBLISHED-TTL:PT1H',
		...cal.events.flatMap((e) => eventLines(e, stamp)),
		'END:VCALENDAR'
	];
	return lines.map(foldLine).join('\r\n') + '\r\n';
}
