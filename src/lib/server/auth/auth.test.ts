import { describe, expect, it } from 'vitest';
import { parseAdminEmails } from './accounts';
import { profileFromIdToken } from './google';
import { landingPath } from './guards';
import type { SessionUser } from './session';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: object) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
const now = new Date('2026-10-14T12:00:00Z');
const valid = {
	iss: 'https://accounts.google.com',
	aud: 'client-1',
	exp: now.getTime() / 1000 + 300,
	sub: '1234',
	email: 'Rozhodci@Example.cz',
	email_verified: true,
	name: 'Test Rozhodčí'
};

describe('profileFromIdToken', () => {
	it('accepts a valid token', () => {
		expect(profileFromIdToken(idToken(valid), 'client-1', now)).toEqual({
			sub: '1234',
			email: 'Rozhodci@Example.cz',
			name: 'Test Rozhodčí',
			picture: null
		});
	});

	it.each([
		['issuer', { iss: 'https://evil.example' }],
		['audience', { aud: 'other-client' }],
		['expired', { exp: now.getTime() / 1000 - 1 }],
		['e-mail', { email_verified: false }]
	])('rejects a bad %s', (_, over) => {
		expect(() => profileFromIdToken(idToken({ ...valid, ...over }), 'client-1', now)).toThrow();
	});
});

describe('accounts', () => {
	it('parses admin e-mails case-insensitively', () => {
		expect(parseAdminEmails(' A@x.cz, b@Y.cz ,,')).toEqual(new Set(['a@x.cz', 'b@y.cz']));
		expect(parseAdminEmails(undefined).size).toBe(0);
	});

	const user = (over: Partial<SessionUser>): SessionUser => ({
		id: 1,
		email: 'a@x.cz',
		name: null,
		avatarUrl: null,
		role: 'user',
		status: 'pending',
		officialId: null,
		requestedOfficialId: null,
		groupId: null,
		firstName: null,
		lastName: null,
		homeAddress: null,
		homeLat: null,
		homeLon: null,
		homeMunicipality: null,
		...over
	});

	it('sends each account state to its page', () => {
		expect(landingPath(null)).toBe('/login');
		expect(landingPath(user({}))).toBe('/pair');
		expect(landingPath(user({ requestedOfficialId: 5 }))).toBe('/pending');
		expect(landingPath(user({ status: 'rejected', requestedOfficialId: 5 }))).toBe('/pending');
		expect(landingPath(user({ status: 'approved', officialId: 5, requestedOfficialId: 5 }))).toBe(
			'/dashboard'
		);
	});
});
