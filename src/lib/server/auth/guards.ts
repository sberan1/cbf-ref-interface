/** Where a visitor belongs given their account state (ADR 0008), and route guards. */
import { redirect } from '@sveltejs/kit';
import type { SessionUser } from './session';

export function landingPath(user: SessionUser | null): string {
	if (!user) return '/login';
	if (user.status === 'approved' && user.officialId !== null) return '/dashboard';
	if (user.requestedOfficialId !== null) return '/pending';
	return '/pair';
}

export type ApprovedUser = SessionUser & { officialId: number };

/** The signed-in user with an approved pairing, otherwise a redirect to where they belong. */
export function requireApproved(user: SessionUser | null): ApprovedUser {
	if (user && user.status === 'approved' && user.officialId !== null) return user as ApprovedUser;
	redirect(303, landingPath(user));
}

export function requireUser(user: SessionUser | null): SessionUser {
	if (!user) redirect(303, '/login');
	return user;
}

export function requireAdmin(user: SessionUser | null): SessionUser {
	const u = requireUser(user);
	if (u.role !== 'admin') redirect(303, landingPath(u));
	return u;
}
