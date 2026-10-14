export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Process-local politeness limiter: at most one request per `minIntervalMs + random(jitterMs)`,
 * plus a global pause after ČBF signals blocking. The fetch queue has a single active consumer,
 * so one limiter instance governs all traffic of the worker fleet (ADR 0003).
 */
export class RateLimiter {
	private nextAt = 0;
	private pausedUntil = 0;

	constructor(
		private readonly minIntervalMs: number,
		private readonly jitterMs: number,
		private readonly now: () => number = Date.now,
		private readonly wait: (ms: number) => Promise<void> = sleep,
		private readonly random: () => number = Math.random
	) {}

	async acquire(): Promise<void> {
		for (;;) {
			const delay = Math.max(this.nextAt, this.pausedUntil) - this.now();
			if (delay <= 0) break;
			await this.wait(delay);
		}
		this.nextAt = this.now() + this.minIntervalMs + Math.floor(this.random() * this.jitterMs);
	}

	pause(ms: number): void {
		this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
	}

	get pausedUntilMs(): number {
		return this.pausedUntil;
	}
}
