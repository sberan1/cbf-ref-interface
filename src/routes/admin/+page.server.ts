import { fail } from '@sveltejs/kit';
import {
	listAccounts,
	PairingError,
	reviewAccount,
	type ReviewDecision
} from '#lib/server/auth/accounts.ts';
import { requireAdmin } from '#lib/server/auth/guards.ts';
import { getDb } from '#lib/server/db/index.ts';
import { log } from '#lib/server/log.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const admin = requireAdmin(locals.user);
	return { accounts: await listAccounts(getDb()), selfId: admin.id };
};

function decide(decision: ReviewDecision) {
	return async ({ locals, request }: Parameters<Actions[string]>[0]) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const userId = Number(form.get('userId'));
		const rawOfficial = String(form.get('officialId') ?? '').trim();
		const officialId = rawOfficial ? Number(rawOfficial) : undefined;
		if (!Number.isInteger(userId) || (officialId !== undefined && !Number.isInteger(officialId))) {
			return fail(400, { userId, error: 'Neplatné ID.' });
		}
		try {
			await reviewAccount(getDb(), admin.id, userId, decision, officialId);
		} catch (err) {
			if (err instanceof PairingError) return fail(400, { userId, error: err.message });
			throw err;
		}
		log.info('account review', {
			adminId: admin.id,
			userId,
			decision,
			officialId: officialId ?? null
		});
		return { userId, done: decision };
	};
}

export const actions: Actions = {
	approve: decide('approve'),
	reject: decide('reject'),
	revoke: decide('revoke')
};
