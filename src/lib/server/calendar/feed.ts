/**
 * Calendar feed (PDR 0006): the person's ČBF delegations and own games as iCalendar events, at a
 * secret URL calendar apps subscribe to. Each game carries everything known about it: teams,
 * competition, phase, round and number, the hall with its address, the whole delegation, the fee,
 * the result and the live / video links.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { formatKc } from '../../format';
import type { DbOrTx } from '../db/client';
import {
	appUser,
	category,
	competition,
	game,
	gameOfficial,
	gameScoreQuarter,
	official,
	officialRoles,
	phase,
	venue
} from '../db/schema';
import type { GameFee } from '../fees';
import { feeView } from '../referee/fee-view';
import { ownGameRoleNames, type OwnGame } from '../referee/own-games';
import { roleNames } from '../referee/queries';
import type { IcsEvent } from './ics';

/** Events take two hours: a game with breaks and the paperwork after it. */
const GAME_MINUTES = 120;
/** How far back the feed goes; older games only slow calendar apps down. */
export const FEED_DAYS_BACK = 365;

const UID_DOMAIN = 'cbf-ref-interface';

/** TV flags of the ČBF game payload. */
const tvChannels: Record<string, string> = {
	ct4: 'ČT sport',
	ct4_sport_plus: 'ČT sport Plus',
	sporty_tv: 'Sporty TV',
	prima_sport: 'Prima Sport',
	slovak_sport_tv: 'Slovak Sport TV',
	studio_basketbal: 'Studio Basketbal'
};

export interface CalendarOwner {
	userId: number;
	officialId: number;
	groupId: number | null;
	lastName: string | null;
}

/** The approved, paired account a feed token belongs to. */
export async function calendarOwner(db: DbOrTx, token: string): Promise<CalendarOwner | null> {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
	const [row] = await db
		.select({
			userId: appUser.id,
			officialId: appUser.officialId,
			status: appUser.status,
			groupId: official.groupId,
			lastName: official.lastName
		})
		.from(appUser)
		.leftJoin(official, eq(official.id, appUser.officialId))
		.where(eq(appUser.calendarToken, token));
	if (!row || row.status !== 'approved' || row.officialId === null) return null;
	return {
		userId: row.userId,
		officialId: row.officialId,
		groupId: row.groupId,
		lastName: row.lastName
	};
}

/** Turns the feed on with a new secret (the old URL stops working), or off. */
export async function setCalendarToken(
	db: DbOrTx,
	userId: number,
	enabled: boolean
): Promise<string | null> {
	const token = enabled ? randomBytes(32).toString('base64url') : null;
	await db.update(appUser).set({ calendarToken: token }).where(eq(appUser.id, userId));
	return token;
}

export async function calendarToken(db: DbOrTx, userId: number): Promise<string | null> {
	const [row] = await db
		.select({ token: appUser.calendarToken })
		.from(appUser)
		.where(eq(appUser.id, userId));
	return row?.token ?? null;
}

export interface CalendarGame {
	id: number;
	role: string;
	startsAt: Date | null;
	scheduledDate: string | null;
	competition: string | null;
	category: string | null;
	phase: string | null;
	round: string | null;
	number: string | null;
	homeTeam: string | null;
	awayTeam: string | null;
	homeScore: number | null;
	awayScore: number | null;
	venue: {
		name: string | null;
		street: string | null;
		zip: string | null;
		city: string | null;
		lat: number | null;
		lon: number | null;
	};
	urlLive: string | null;
	videoUrl: string | null;
	tv: string[];
	/** whole delegation, the person included */
	officials: { role: string; name: string }[];
	/** points per period; period 5 = all overtimes */
	quarters: { period: number; home: number | null; away: number | null }[];
}

const truthy = (v: unknown) => v === true || v === 1 || v === '1';

/** Delegations of the person from `from` on (YYYY-MM-DD), with everything the feed shows. */
export async function calendarGames(
	db: DbOrTx,
	officialIds: number[],
	from: string
): Promise<CalendarGame[]> {
	const rows = await db
		.select({
			id: game.id,
			role: gameOfficial.role,
			startsAt: game.startsAt,
			scheduledDate: game.scheduledDate,
			competition: competition.name,
			category: category.name,
			categoryRaw: competition.extra,
			phase: phase.name,
			round: game.round,
			number: game.number,
			homeTeam: game.homeTeamName,
			awayTeam: game.awayTeamName,
			homeScore: game.homeScore,
			awayScore: game.awayScore,
			venueName: venue.name,
			street: venue.street,
			zip: venue.zip,
			city: venue.city,
			lat: venue.lat,
			lon: venue.lon,
			urlLive: game.urlLive,
			videoUrl: game.videoUrl,
			isTv: game.isTv,
			extra: game.extra
		})
		.from(gameOfficial)
		.innerJoin(game, eq(game.id, gameOfficial.gameId))
		.leftJoin(competition, eq(competition.id, game.competitionId))
		.leftJoin(category, eq(category.id, competition.categoryId))
		.leftJoin(phase, eq(phase.id, game.phaseId))
		.leftJoin(venue, eq(venue.id, game.venueId))
		.where(and(inArray(gameOfficial.officialId, officialIds), gte(game.scheduledDate, from)))
		.orderBy(asc(game.scheduledDate), asc(game.scheduledTime));
	if (rows.length === 0) return [];

	const ids = [...new Set(rows.map((r) => r.id))];
	const [crew, quarters] = await Promise.all([
		db
			.select({
				gameId: gameOfficial.gameId,
				role: gameOfficial.role,
				firstName: gameOfficial.firstName,
				lastName: gameOfficial.lastName,
				officialFirst: official.firstName,
				officialLast: official.lastName
			})
			.from(gameOfficial)
			.innerJoin(official, eq(official.id, gameOfficial.officialId))
			.where(inArray(gameOfficial.gameId, ids)),
		db
			.select()
			.from(gameScoreQuarter)
			.where(inArray(gameScoreQuarter.gameId, ids))
			.orderBy(asc(gameScoreQuarter.period))
	]);
	// referees first, then the commissioner
	crew.sort((a, b) => officialRoles.indexOf(a.role) - officialRoles.indexOf(b.role));
	const crewOf = Map.groupBy(crew, (c) => c.gameId);
	const quartersOf = Map.groupBy(quarters, (q) => q.gameId);

	return rows.map((r) => {
		const extra = (r.extra ?? {}) as Record<string, unknown>;
		const raw = (r.categoryRaw ?? {}) as Record<string, unknown>;
		const tv = Object.entries(tvChannels)
			.filter(([key]) => truthy(extra[key]))
			.map(([, name]) => name);
		if (r.isTv && tv.length === 0) tv.push('ČT sport');
		return {
			id: r.id,
			role: r.role,
			startsAt: r.startsAt,
			scheduledDate: r.scheduledDate,
			competition: r.competition,
			category: r.category ?? (typeof raw.catname === 'string' ? raw.catname : null),
			phase: r.phase,
			round: r.round,
			number: r.number,
			homeTeam: r.homeTeam,
			awayTeam: r.awayTeam,
			homeScore: r.homeScore,
			awayScore: r.awayScore,
			venue: {
				name: r.venueName,
				street: r.street,
				zip: r.zip,
				city: r.city,
				lat: r.lat,
				lon: r.lon
			},
			urlLive: r.urlLive || null,
			videoUrl: r.videoUrl || null,
			tv,
			officials: (crewOf.get(r.id) ?? []).map((c) => ({
				role: c.role,
				name: [c.firstName ?? c.officialFirst, c.lastName ?? c.officialLast]
					.filter(Boolean)
					.join(' ')
			})),
			quarters: (quartersOf.get(r.id) ?? []).map((q) => ({
				period: q.period,
				home: q.home,
				away: q.away
			}))
		};
	});
}

const teams = (g: { homeTeam: string | null; awayTeam: string | null }) =>
	`${g.homeTeam ?? '?'} – ${g.awayTeam ?? '?'}`;

function address(v: CalendarGame['venue']): string | null {
	const town = [v.zip, v.city].filter(Boolean).join(' ');
	const parts = [v.name, v.street, town].filter(Boolean);
	return parts.length > 0 ? parts.join(', ') : null;
}

function gameDescription(g: CalendarGame, fee: GameFee | undefined, payoutsUrl: string): string {
	const lines: string[] = [];
	const comp = [
		g.competition,
		g.category && !(g.competition ?? '').includes(g.category) ? g.category : null
	]
		.filter(Boolean)
		.join(' · ');
	if (comp) lines.push(`Soutěž: ${comp}`);
	const stage = [
		g.phase,
		g.round ? `${g.round}. kolo` : null,
		g.number ? `utkání č. ${g.number}` : null
	].filter(Boolean);
	if (stage.length > 0) lines.push(stage.join(', '));
	lines.push(`Moje role: ${roleNames[g.role] ?? g.role}`);
	lines.push('');
	for (const o of g.officials) {
		const name = roleNames[o.role] ?? o.role;
		lines.push(`${name.charAt(0).toUpperCase()}${name.slice(1)}: ${o.name}`);
	}
	const where = address(g.venue);
	if (where) lines.push('', `Hala: ${where}`);

	const f = feeView(fee);
	if (f) {
		lines.push('');
		if (f.amount === null) lines.push(`Odměna: – (${f.detail})`);
		else
			lines.push(
				`Odměna: ${f.estimate ? '≈ ' : ''}${formatKc(f.amount)}${f.detail ? ` (${f.detail})` : ''}`
			);
	}
	if (g.homeScore !== null && g.awayScore !== null) {
		const periods = g.quarters
			.filter((q) => q.home !== null && q.away !== null)
			.map((q) => `${q.period === 5 ? 'prodl. ' : ''}${q.home}:${q.away}`);
		lines.push(
			`Výsledek: ${g.homeScore}:${g.awayScore}${periods.length > 0 ? ` (${periods.join(', ')})` : ''}`
		);
	}
	const links: string[] = [];
	if (g.tv.length > 0) links.push(`Televize: ${g.tv.join(', ')}`);
	if (g.videoUrl) links.push(`Video: ${g.videoUrl}`);
	if (g.urlLive) links.push(`Live statistiky: ${g.urlLive}`);
	links.push(`Vyúčtování: ${payoutsUrl}`);
	lines.push('', ...links);
	return lines.join('\n');
}

export function gameEvent(
	g: CalendarGame,
	fee: GameFee | undefined,
	appUrl: string
): IcsEvent | null {
	const date = g.scheduledDate;
	if (!date) return null;
	const comp = g.competition ? ` · ${g.competition}` : '';
	const event: IcsEvent = {
		uid: `game-${g.id}-${g.role}@${UID_DOMAIN}`,
		summary: `${g.role === 'commissioner' ? 'Komisař: ' : ''}${teams(g)}${comp}`,
		description: gameDescription(g, fee, `${appUrl}/payouts?m=${date.slice(0, 7)}`),
		location: address(g.venue) ?? undefined,
		geo:
			g.venue.lat !== null && g.venue.lon !== null
				? { lat: g.venue.lat, lon: g.venue.lon }
				: undefined,
		url: g.urlLive ?? undefined
	};
	if (g.startsAt) {
		event.start = g.startsAt;
		event.end = new Date(g.startsAt.getTime() + GAME_MINUTES * 60_000);
	} else {
		event.date = date;
	}
	return event;
}

export function ownGameEvent(o: OwnGame): IcsEvent {
	const lines = [
		`Vlastní zápas · ${ownGameRoleNames[o.role]}`,
		o.games > 1 ? `Počet zápasů: ${o.games}` : null,
		`Odměna: ${o.fee === null ? 'neznámá' : formatKc(o.fee)}`,
		o.note ? `Poznámka: ${o.note}` : null
	].filter((l): l is string => l !== null);
	return {
		uid: `own-${o.id}@${UID_DOMAIN}`,
		date: o.date,
		summary: o.title,
		description: lines.join('\n'),
		location: o.place ?? undefined
	};
}

/** Events of the feed: ČBF delegations, then own games. */
export function calendarEvents(
	games: CalendarGame[],
	fees: Map<string, GameFee>,
	own: OwnGame[],
	appUrl: string
): IcsEvent[] {
	return [
		...games.flatMap((g) => gameEvent(g, fees.get(`${g.id}:${g.role}`), appUrl) ?? []),
		...own.map(ownGameEvent)
	];
}
