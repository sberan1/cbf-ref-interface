import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { landingPath, requireUser } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { official } from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals.user);
	if (landingPath(user) !== '/pending' && user.status !== 'rejected') {
		redirect(303, landingPath(user));
	}
	const [requested] = user.requestedOfficialId
		? await getDb()
				.select({ id: official.id, firstName: official.firstName, lastName: official.lastName })
				.from(official)
				.where(eq(official.id, user.requestedOfficialId))
		: [];
	return { status: user.status, account: user.email, requested: requested ?? null };
};
