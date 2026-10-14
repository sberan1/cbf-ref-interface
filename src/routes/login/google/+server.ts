import { redirect } from '@sveltejs/kit';
import { generateCodeVerifier, generateState } from 'arctic';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '$app/env/private';
import {
	GOOGLE_SCOPES,
	GOOGLE_STATE_COOKIE,
	GOOGLE_VERIFIER_COOKIE,
	googleClient
} from '#lib/server/auth/google.ts';
import type { RequestHandler } from './$types';

/** Starts the Google sign-in: state + PKCE verifier in short-lived cookies, then off to Google. */
export const GET: RequestHandler = ({ cookies, url }) => {
	if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) redirect(303, '/login?error=config');
	const state = generateState();
	const verifier = generateCodeVerifier();
	const google = googleClient(
		{ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
		url.origin
	);
	const authUrl = google.createAuthorizationURL(state, verifier, GOOGLE_SCOPES);
	authUrl.searchParams.set('prompt', 'select_account');
	const options = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: 10 * 60 };
	cookies.set(GOOGLE_STATE_COOKIE, state, options);
	cookies.set(GOOGLE_VERIFIER_COOKIE, verifier, options);
	redirect(302, authUrl.toString(), { external: ['https://accounts.google.com'] });
};
