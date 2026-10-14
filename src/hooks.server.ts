import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	setSessionCookie,
	validateSessionToken
} from '#lib/server/auth/session.ts';
import { ADMIN_EMAILS } from '$app/env/private';
import { parseAdminEmails } from '#lib/server/auth/accounts.ts';
import { getDb } from '#lib/server/db/index.ts';
import { log } from '#lib/server/log.ts';

/** Requests not worth a log line: Docker healthchecks and hashed static assets. */
const quiet = (path: string) => path === '/healthz' || path.startsWith('/_app/');

export const handle: Handle = async ({ event, resolve }) => {
	const started = performance.now();
	event.locals.user = null;
	event.locals.session = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const result = await validateSessionToken(getDb(), token);
		if (result) {
			// the role follows ADMIN_EMAILS on every request, not only at the last sign-in
			event.locals.user = {
				...result.user,
				role: parseAdminEmails(ADMIN_EMAILS).has(result.user.email.toLowerCase()) ? 'admin' : 'user'
			};
			event.locals.session = result.session;
			if (result.renewed) setSessionCookie(event.cookies, token, result.session.expiresAt);
		} else {
			deleteSessionCookie(event.cookies);
		}
	}

	const response = await resolve(event);
	if (!quiet(event.url.pathname)) {
		log.info('request', {
			method: event.request.method,
			path: event.url.pathname,
			route: event.route.id,
			status: response.status,
			ms: Math.round(performance.now() - started),
			userId: event.locals.user?.id ?? null
		});
	}
	return response;
};

export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind === 'unknown') {
		log.error('unhandled error', {
			method: event.request.method,
			path: event.url.pathname,
			route: event.route.id,
			userId: event.locals.user?.id ?? null,
			err: error instanceof Error ? (error.stack ?? error.message) : String(error)
		});
	}
};
