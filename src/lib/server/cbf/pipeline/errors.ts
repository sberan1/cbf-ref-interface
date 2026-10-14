import { ZodError } from 'zod';
import { CbfParseError } from '../parse/payload';

/** Fails the message for good (dead-letter queue), no retries. */
export class PermanentError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'PermanentError';
	}
}

/** Explicitly retryable failure (HTTP 5xx, timeouts, ČBF blocking us, …). */
export class RetryableError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'RetryableError';
	}
}

const transientPgClasses = ['08', '40', '53', '57'];
const transientNodeCodes = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ETIMEDOUT',
	'EPIPE',
	'ENOTFOUND'
]);

/** Unknown errors are retried (they are usually infrastructure), except known data/logic errors. */
export function isRetryable(err: unknown): boolean {
	if (err instanceof RetryableError) return true;
	if (err instanceof PermanentError || err instanceof CbfParseError || err instanceof ZodError) {
		return false;
	}
	const code = (err as { code?: unknown } | null)?.code;
	if (typeof code === 'string') {
		if (transientNodeCodes.has(code)) return true;
		// Postgres SQLSTATE: connection, rollback/deadlock, resources, operator intervention
		if (/^[0-9A-Z]{5}$/.test(code)) return transientPgClasses.includes(code.slice(0, 2));
	}
	return true;
}
