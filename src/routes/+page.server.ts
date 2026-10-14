import { redirect } from '@sveltejs/kit';
import { landingPath } from '#lib/server/auth/guards.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	redirect(303, landingPath(locals.user));
};
