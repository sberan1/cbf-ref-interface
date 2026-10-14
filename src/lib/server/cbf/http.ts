import { createHash } from 'node:crypto';
import type { CbfConfig } from './config';
import { buildUrl, type EndpointDef, type Params } from './endpoints';
import type { RateLimiter } from './rate-limiter';

export interface FetchResult {
	url: string;
	status: number;
	contentType: string | null;
	body: string;
	byteSize: number;
	contentHash: string;
	startedAt: Date;
	durationMs: number;
}

export type HttpErrorKind = 'network' | 'timeout' | 'server' | 'client' | 'blocked';

export class CbfHttpError extends Error {
	constructor(
		readonly kind: HttpErrorKind,
		message: string,
		readonly url: string,
		readonly startedAt: Date,
		readonly durationMs: number,
		readonly status?: number
	) {
		super(message);
		this.name = 'CbfHttpError';
	}

	get retryable(): boolean {
		return this.kind !== 'client';
	}
}

/** Statuses that look like ČBF throttling or blocking us; all traffic pauses (ADR 0005). */
const BLOCK_STATUSES = new Set([403, 429, 503]);

export class CbfHttpClient {
	constructor(
		private readonly config: CbfConfig['http'],
		private readonly limiter: RateLimiter
	) {}

	url(def: EndpointDef, params: Params): string {
		return buildUrl(this.config.baseUrl, def, params);
	}

	/**
	 * Performs one rate-limited GET. 2xx and 404 resolve (404 is stored as an empty resource);
	 * everything else rejects with CbfHttpError.
	 */
	async get(def: EndpointDef, params: Params): Promise<FetchResult> {
		const url = this.url(def, params);
		await this.limiter.acquire();
		const startedAt = new Date();
		const elapsed = () => Date.now() - startedAt.getTime();

		let response: Response;
		try {
			response = await fetch(url, {
				headers: {
					'user-agent': this.config.userAgent,
					accept: 'application/json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5'
				},
				signal: AbortSignal.timeout(this.config.timeoutMs)
			});
		} catch (err) {
			const timeout = err instanceof Error && err.name === 'TimeoutError';
			throw new CbfHttpError(
				timeout ? 'timeout' : 'network',
				err instanceof Error ? err.message : String(err),
				url,
				startedAt,
				elapsed()
			);
		}

		const bytes = new Uint8Array(await response.arrayBuffer());
		const contentType = response.headers.get('content-type');
		const status = response.status;

		if (BLOCK_STATUSES.has(status)) {
			this.limiter.pause(this.config.blockPauseMs);
			throw new CbfHttpError('blocked', `HTTP ${status}`, url, startedAt, elapsed(), status);
		}
		if (status >= 500) {
			throw new CbfHttpError('server', `HTTP ${status}`, url, startedAt, elapsed(), status);
		}
		if (status >= 400 && status !== 404) {
			throw new CbfHttpError('client', `HTTP ${status}`, url, startedAt, elapsed(), status);
		}

		const body = decodeBody(bytes, contentType);
		return {
			url,
			status,
			contentType,
			body,
			byteSize: bytes.byteLength,
			contentHash: sha256(body),
			startedAt,
			durationMs: elapsed()
		};
	}
}

export function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

/** Decodes using the HTTP charset, then the XML declaration, then UTF-8 (v1 XML may be cp1250). */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
	const charset = detectCharset(bytes, contentType);
	let text: string;
	try {
		text = new TextDecoder(charset).decode(bytes);
	} catch {
		text = new TextDecoder('utf-8').decode(bytes);
	}
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectCharset(bytes: Uint8Array, contentType: string | null): string {
	const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '');
	if (fromHeader) return fromHeader[1].toLowerCase();
	const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
	const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head);
	if (fromXml) return fromXml[1].toLowerCase();
	return 'utf-8';
}
