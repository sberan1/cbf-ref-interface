import type { LayoutServerLoad } from './$types';

/** Only what the header needs; the full session user stays on the server. */
export const load: LayoutServerLoad = ({ locals }) => {
	const u = locals.user;
	if (!u) return { user: null };
	const approved = u.status === 'approved' && u.officialId !== null;
	return {
		user: {
			displayName:
				approved && u.lastName ? `${u.firstName ?? ''} ${u.lastName}`.trim() : (u.name ?? u.email),
			firstName: u.firstName,
			lastName: u.lastName,
			avatarUrl: u.avatarUrl,
			isAdmin: u.role === 'admin',
			approved
		}
	};
};
