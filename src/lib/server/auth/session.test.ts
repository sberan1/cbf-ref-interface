import { describe, expect, it } from 'vitest';
import { generateSessionToken, SESSION_TTL_MS, sessionIdFromToken, shouldRenew } from './session';

describe('session tokens', () => {
	it('generates unguessable tokens and stores only their hash', () => {
		const a = generateSessionToken();
		const b = generateSessionToken();
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(sessionIdFromToken(a)).toMatch(/^[0-9a-f]{64}$/);
		expect(sessionIdFromToken(a)).toBe(sessionIdFromToken(a));
		expect(sessionIdFromToken(a)).not.toBe(a);
	});

	it('renews sessions in the second half of their lifetime', () => {
		const now = new Date('2026-10-14T12:00:00Z');
		expect(shouldRenew(new Date(now.getTime() + SESSION_TTL_MS), now)).toBe(false);
		expect(shouldRenew(new Date(now.getTime() + 10 * 24 * 3600_000), now)).toBe(true);
	});
});
