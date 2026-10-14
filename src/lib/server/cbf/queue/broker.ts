/**
 * RabbitMQ transport of the sync pipeline (ADR 0003).
 *
 *   cbf.fetch      priority queue, single active consumer → global rate limit holds for any
 *                  number of worker processes
 *   cbf.normalize  priority queue, parallel consumers
 *   <q>.retry.30s|5m|30m  TTL queues dead-lettering back to <q> (delayed retries)
 *   <q>.dead       parking lot for messages that failed for good (inspect, then `requeue-dead`)
 */
import amqp, { type Channel, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { once } from 'node:events';
import { errorMessage, log } from '../log';
import {
	MAX_PRIORITY,
	taskPriority,
	type NewFetchTask,
	type NormalizeTask,
	type SyncReason,
	type TaskContext,
	type TaskSink
} from '../tasks';

export const queues = { fetch: 'cbf.fetch', normalize: 'cbf.normalize' } as const;
export type QueueRole = keyof typeof queues;

export const retryTiers = [
	{ suffix: '30s', ttlMs: 30_000 },
	{ suffix: '5m', ttlMs: 5 * 60_000 },
	{ suffix: '30m', ttlMs: 30 * 60_000 }
] as const;

export const retryQueue = (role: QueueRole, suffix: string) => `${queues[role]}.retry.${suffix}`;
export const deadQueue = (role: QueueRole) => `${queues[role]}.dead`;

/** Changing queue arguments later requires deleting the queue (RabbitMQ refuses redeclaration). */
export async function assertTopology(ch: Channel) {
	await ch.assertQueue(queues.fetch, {
		durable: true,
		maxPriority: MAX_PRIORITY,
		arguments: { 'x-queue-type': 'classic', 'x-single-active-consumer': true }
	});
	await ch.assertQueue(queues.normalize, {
		durable: true,
		maxPriority: MAX_PRIORITY,
		arguments: { 'x-queue-type': 'classic' }
	});
	for (const role of Object.keys(queues) as QueueRole[]) {
		for (const tier of retryTiers) {
			await ch.assertQueue(retryQueue(role, tier.suffix), {
				durable: true,
				messageTtl: tier.ttlMs,
				deadLetterExchange: '',
				deadLetterRoutingKey: queues[role]
			});
		}
		await ch.assertQueue(deadQueue(role), { durable: true });
	}
}

/** attempt 1 → 30 s, 2 → 5 min, 3+ → 30 min. */
export function retryTierFor(attempt: number) {
	return retryTiers[Math.min(Math.max(attempt, 1), retryTiers.length) - 1];
}

type Prioritized = { reason: SyncReason; ctx: TaskContext };

export interface Consumer {
	cancel(): Promise<void>;
}

export class Broker implements TaskSink {
	private drain: Promise<void> | null = null;
	readonly closed: Promise<Error | undefined>;

	private constructor(
		private readonly conn: ChannelModel,
		private readonly pub: ConfirmChannel,
		private readonly currentYear: () => number
	) {
		this.closed = new Promise((resolve) => {
			conn.on('close', (err?: Error) => resolve(err));
			conn.on('error', (err: Error) => log.error('amqp connection error', { err: err.message }));
		});
	}

	static async connect(url: string, currentYear: () => number): Promise<Broker> {
		const conn = await amqp.connect(url);
		const pub = await conn.createConfirmChannel();
		await assertTopology(pub);
		return new Broker(conn, pub, currentYear);
	}

	private async send(
		queue: string,
		body: unknown,
		options: { priority?: number; headers?: Record<string, unknown> } = {}
	): Promise<void> {
		if (this.drain) await this.drain;
		await new Promise<void>((resolve, reject) => {
			const ok = this.pub.sendToQueue(
				queue,
				Buffer.from(JSON.stringify(body)),
				{ persistent: true, contentType: 'application/json', ...options },
				(err) => (err ? reject(err) : resolve())
			);
			if (!ok && !this.drain) {
				this.drain = once(this.pub, 'drain').then(() => {
					this.drain = null;
				});
			}
		});
	}

	private priority(task: Prioritized) {
		return taskPriority(task, this.currentYear());
	}

	async fetch(task: NewFetchTask & { attempt?: number }): Promise<void> {
		await this.send(
			queues.fetch,
			{ ...task, attempt: task.attempt ?? 0 },
			{ priority: this.priority(task) }
		);
	}

	async normalize(task: Omit<NormalizeTask, 'attempt'> & { attempt?: number }): Promise<void> {
		await this.send(
			queues.normalize,
			{ ...task, attempt: task.attempt ?? 0 },
			{ priority: this.priority(task) }
		);
	}

	/** Re-publishes a failed task with a delay; it comes back to the main queue when the TTL expires. */
	async retry(role: QueueRole, task: Prioritized & { attempt: number }, error: string) {
		const tier = retryTierFor(task.attempt);
		await this.send(retryQueue(role, tier.suffix), task, {
			priority: this.priority(task),
			headers: { 'x-last-error': error.slice(0, 1000) }
		});
	}

	async dead(role: QueueRole, task: unknown, error: string) {
		await this.send(deadQueue(role), task, {
			headers: { 'x-error': error.slice(0, 4000), 'x-failed-at': new Date().toISOString() }
		});
	}

	/**
	 * Consumes a queue; the message is acked after `handler` resolves and requeued when it throws
	 * (handlers are expected to route their own failures to retry/dead queues).
	 */
	async consume(
		role: QueueRole,
		prefetch: number,
		handler: (body: unknown) => Promise<void>
	): Promise<Consumer> {
		const ch = await this.conn.createChannel();
		await ch.prefetch(prefetch);
		const inflight = new Set<Promise<void>>();
		const { consumerTag } = await ch.consume(queues[role], (msg) => {
			if (!msg) return;
			const work = (async () => {
				try {
					let body: unknown;
					try {
						body = JSON.parse(msg.content.toString('utf8'));
					} catch {
						await this.dead(role, msg.content.toString('utf8'), 'invalid JSON');
						ch.ack(msg);
						return;
					}
					await handler(body);
					ch.ack(msg);
				} catch (err) {
					log.error('handler failed, requeueing', { queue: queues[role], err: errorMessage(err) });
					try {
						ch.nack(msg, false, true);
					} catch {
						// channel already closed; the broker redelivers the message
					}
				}
			})();
			inflight.add(work);
			void work.finally(() => inflight.delete(work));
		});
		return {
			cancel: async () => {
				await ch.cancel(consumerTag).catch(() => undefined);
				await Promise.allSettled([...inflight]);
				await ch.close().catch(() => undefined);
			}
		};
	}

	async queueStats() {
		const ch = await this.conn.createChannel();
		try {
			const names = (Object.keys(queues) as QueueRole[]).flatMap((role) => [
				queues[role],
				...retryTiers.map((t) => retryQueue(role, t.suffix)),
				deadQueue(role)
			]);
			const out: { queue: string; messages: number; consumers: number }[] = [];
			for (const queue of names) {
				const q = await ch.checkQueue(queue);
				out.push({ queue, messages: q.messageCount, consumers: q.consumerCount });
			}
			return out;
		} finally {
			await ch.close().catch(() => undefined);
		}
	}

	/** Moves dead messages back to the main queue with a reset attempt counter. */
	async requeueDead(role: QueueRole, limit = Number.POSITIVE_INFINITY): Promise<number> {
		const ch = await this.conn.createChannel();
		let moved = 0;
		try {
			while (moved < limit) {
				const msg = await ch.get(deadQueue(role), { noAck: false });
				if (!msg) break;
				try {
					const task = JSON.parse(msg.content.toString('utf8')) as Prioritized & {
						attempt?: number;
					};
					await this.send(queues[role], { ...task, attempt: 0 }, { priority: this.priority(task) });
					ch.ack(msg);
					moved++;
				} catch (err) {
					ch.nack(msg, false, true);
					throw err;
				}
			}
		} finally {
			await ch.close().catch(() => undefined);
		}
		return moved;
	}

	async close() {
		await this.pub.close().catch(() => undefined);
		await this.conn.close().catch(() => undefined);
	}
}
