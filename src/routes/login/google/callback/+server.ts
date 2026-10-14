import { redirect } from '@sveltejs/kit';
import { ADMIN_EMAILS, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '$app/env/private';
import { parseAdminEmails, signInWithGoogle } from '#lib/server/auth/accounts.ts';
import {
	GOOGLE_STATE_COOKIE,
	GOOGLE_VERIFIER_COOKIE,
	googleClient,
	profileFromIdToken
} from '#lib/server/auth/google.ts';
import { createSession, setSessionCookie } from '#lib/server/auth/session.ts';
import { getDb } from '#lib/server/db/index.ts';
import { log } from '#lib/server/log.ts';
import type { RequestHandler } from './$types';

/** Google redirects back here; a valid code ends with a session and a redirect to `/`. */
export const GET: RequestHandler = async ({ cookies, url }) => {
	if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) redirect(303, '/login?error=config');
	const state = url.searchParams.get('state');
	const code = url.searchParams.get('code');
	const storedState = cookies.get(GOOGLE_STATE_COOKIE);
	const verifier = cookies.get(GOOGLE_VERIFIER_COOKIE);
	cookies.delete(GOOGLE_STATE_COOKIE, { path: '/' });
	cookies.delete(GOOGLE_VERIFIER_COOKIE, { path: '/' });
	if (!state || !code || !storedState || !verifier || state !== storedState) {
		log.warn('google sign-in: bad state', { hasCode: !!code, hasState: !!state });
		redirect(303, '/login?error=state');
	}

	let profile;
	try {
		const google = googleClient(
			{ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
			url.origin
		);
		const tokens = await google.validateAuthorizationCode(code, verifier);
		profile = profileFromIdToken(tokens.idToken(), GOOGLE_CLIENT_ID);
	} catch (err) {
		log.warn('google sign-in failed', { err: err instanceof Error ? err.message : String(err) });
		redirect(
			303,
			`/login?error=${err instanceof Error && err.message.includes('e-mail') ? 'email' : 'google'}`
		);
	}

	const db = getDb();
	const userId = await signInWithGoogle(db, profile, parseAdminEmails(ADMIN_EMAILS));
	const { token, expiresAt } = await createSession(db, userId);
	log.info('signed in', { userId, provider: 'google' });
	setSessionCookie(cookies, token, expiresAt);
	redirect(303, '/');
};
