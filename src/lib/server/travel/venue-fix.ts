/**
 * Hand-corrected hall positions (PDR 0003). A correction is shared by everyone and wins over the
 * GPS from ČBF; default trips through the hall are dropped so they get computed again.
 */
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { appTrip, appVenueFix, game } from '../db/schema';

/** Default trips of every user with a stop at a game played in the venue. */
async function dropAutoTrips(db: DbOrTx, venueId: number) {
	await db.delete(appTrip).where(sql`${appTrip.status} = 'auto' and exists (
		select 1
		from jsonb_array_elements(case when jsonb_typeof(${appTrip.stops}) = 'array' then ${appTrip.stops} else '[]'::jsonb end) s
		cross join jsonb_array_elements_text(case when jsonb_typeof(s->'gameIds') = 'array' then s->'gameIds' else '[]'::jsonb end) gid
		join ${game} g on g.id = gid::int
		where s->>'kind' = 'venue' and g.venue_id = ${venueId}
	)`);
}

export async function setVenueFix(
	db: DbOrTx,
	fix: { venueId: number; address: string; lat: number; lon: number; userId: number }
) {
	const values = { ...fix, updatedAt: new Date() };
	await db
		.insert(appVenueFix)
		.values(values)
		.onConflictDoUpdate({ target: appVenueFix.venueId, set: values });
	await dropAutoTrips(db, fix.venueId);
}

export async function clearVenueFix(db: DbOrTx, venueId: number) {
	await db.delete(appVenueFix).where(eq(appVenueFix.venueId, venueId));
	await dropAutoTrips(db, venueId);
}

/** Link to the point on mapy.com (documented URL, no API key). */
export const mapUrl = (p: { lat: number; lon: number }) =>
	`https://mapy.com/fnc/v1/showmap?mapset=basic&center=${p.lon},${p.lat}&zoom=17&marker=true`;
