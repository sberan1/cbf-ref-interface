import type { GameFee } from '../fees';

/** What the game lists show about a fee: amount, or why there is none. */
export function feeView(fee: GameFee | undefined) {
	if (!fee) return null;
	if (fee.amount === null) return { amount: null, estimate: false, detail: fee.reason };
	return {
		amount: fee.amount,
		estimate: fee.provenance === 'assumed',
		detail: [fee.label, fee.singleReferee ? '1,5× jeden rozhodčí' : null, fee.note]
			.filter(Boolean)
			.join(' · ')
	};
}
