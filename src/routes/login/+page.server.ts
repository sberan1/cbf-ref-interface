import { redirect } from '@sveltejs/kit';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '$app/env/private';
import { landingPath } from '#lib/server/auth/guards.ts';
import type { PageServerLoad } from './$types';

const errors: Record<string, string> = {
	state: 'Přihlášení vypršelo nebo bylo přerušeno, zkus to znovu.',
	google: 'Google přihlášení se nepodařilo dokončit, zkus to znovu.',
	email: 'Google účet nemá ověřený e-mail.',
	config: 'Přihlášení přes Google není na serveru nastavené.',
	conflict: 'Účet s tímto e-mailem patří jinému Google účtu. Kontaktuj správce.'
};

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, landingPath(locals.user));
	const code = url.searchParams.get('error');
	return {
		configured: !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET,
		error: code ? (errors[code] ?? errors.google) : null
	};
};
