import {
	calendarEvents,
	calendarGames,
	calendarOwner,
	FEED_DAYS_BACK
} from '#lib/server/calendar/feed.ts';
import { renderCalendar } from '#lib/server/calendar/ics.ts';
import { getDb } from '#lib/server/db/index.ts';
import { feeIndex, personFees } from '#lib/server/referee/earnings.ts';
import { listOwnGames } from '#lib/server/referee/own-games.ts';
import { personOfficialIds, pragueToday } from '#lib/server/referee/queries.ts';
import type { RequestHandler } from './$types';

/**
 * Calendar feed (PDR 0006, ADR 0010). Calendar apps cannot sign in, so the secret token in the URL is the
 * only credential; an unknown or revoked token gets a plain 404.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const db = getDb();
	const owner = await calendarOwner(db, params.token);
	if (!owner) return new Response('Not found', { status: 404 });

	const now = new Date();
	const today = pragueToday(now);
	const from = new Date(Date.parse(`${today}T00:00:00Z`) - FEED_DAYS_BACK * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const ids = await personOfficialIds(db, owner);
	const [games, fees, own] = await Promise.all([
		calendarGames(db, ids, from),
		personFees(db, ids, today),
		listOwnGames(db, owner.userId)
	]);
	const body = renderCalendar({
		name: owner.lastName ? `Rozhodčí ČBF – ${owner.lastName}` : 'Rozhodčí ČBF',
		now,
		events: calendarEvents(
			games,
			feeIndex(fees),
			own.filter((g) => g.date >= from),
			url.origin
		)
	});
	return new Response(body, {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': 'inline; filename="rozhodci-cbf.ics"',
			'cache-control': 'private, max-age=900'
		}
	});
};
