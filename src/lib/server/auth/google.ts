/**
 * Google sign-in (OpenID Connect, authorization code flow with PKCE) via `arctic`. The ID token
 * comes straight from Google's token endpoint over TLS, so its claims are checked, not its
 * signature (OIDC Core 3.1.3.7).
 */
import { decodeIdToken, Google } from 'arctic';
import type { GoogleProfile } from './accounts';

export const GOOGLE_STATE_COOKIE = 'google_oauth_state';
export const GOOGLE_VERIFIER_COOKIE = 'google_code_verifier';
export const GOOGLE_SCOPES = ['openid', 'profile', 'email'];

export interface GoogleConfig {
	clientId: string;
	clientSecret: string;
}

export function googleClient(config: GoogleConfig, origin: string): Google {
	return new Google(config.clientId, config.clientSecret, `${origin}/login/google/callback`);
}

interface IdTokenClaims {
	iss?: string;
	aud?: string | string[];
	exp?: number;
	sub?: string;
	email?: string;
	email_verified?: boolean;
	name?: string;
	picture?: string;
}

/** Checks the ID token claims and returns the profile; throws on anything unexpected. */
export function profileFromIdToken(
	idToken: string,
	clientId: string,
	now = new Date()
): GoogleProfile {
	const claims = decodeIdToken(idToken) as IdTokenClaims;
	if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
		throw new Error('unexpected issuer');
	}
	const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!audience.includes(clientId)) throw new Error('unexpected audience');
	if (!claims.exp || claims.exp * 1000 < now.getTime()) throw new Error('expired ID token');
	if (!claims.sub || !claims.email) throw new Error('missing subject or e-mail');
	if (claims.email_verified !== true) throw new Error('e-mail not verified');
	return {
		sub: claims.sub,
		email: claims.email,
		name: claims.name ?? null,
		picture: claims.picture ?? null
	};
}
