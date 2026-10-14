import { z } from 'zod';
import { endpointKeys, type EndpointKey } from './endpoints';

export const syncReasons = ['bootstrap', 'daily', 'window', 'manual'] as const;
export type SyncReason = (typeof syncReasons)[number];

/** Context propagated from parent to child tasks (used for priority and refresh policy). */
const taskContextSchema = z.object({
	seasonYear: z.number().int().optional(),
	areaId: z.number().int().optional(),
	female: z.number().int().optional(),
	competitionId: z.number().int().optional(),
	phaseId: z.number().int().optional()
});
export type TaskContext = z.infer<typeof taskContextSchema>;

const baseTask = {
	endpoint: z.enum(endpointKeys),
	params: z.record(z.string(), z.string()),
	reason: z.enum(syncReasons),
	/** Expand to child resources after normalization. */
	recurse: z.boolean(),
	/** Ignore freshness (fetch) / normalized state (normalize). */
	force: z.boolean().optional(),
	ctx: taskContextSchema,
	attempt: z.number().int().min(0).default(0)
};

export const fetchTaskSchema = z.object({
	...baseTask,
	/** Refetch when the last fetch is older than this, regardless of next_due_at. */
	maxAgeSec: z.number().int().min(0).optional()
});
export type FetchTask = z.infer<typeof fetchTaskSchema>;

export const normalizeTaskSchema = z.object(baseTask);
export type NormalizeTask = z.infer<typeof normalizeTaskSchema>;

export interface NewFetchTask {
	endpoint: EndpointKey;
	params: Record<string, string>;
	reason: SyncReason;
	recurse: boolean;
	ctx: TaskContext;
	force?: boolean;
	maxAgeSec?: number;
}

/** Where handlers put follow-up work; implemented by the RabbitMQ broker (and in-memory in tests). */
export interface TaskSink {
	fetch(task: NewFetchTask & { attempt?: number }): Promise<void>;
	normalize(task: Omit<NormalizeTask, 'attempt'> & { attempt?: number }): Promise<void>;
}

export const MAX_PRIORITY = 10;

/**
 * Queue priority (0–10): manual > window > daily > bootstrap; bootstrap prefers newer seasons,
 * so the recent history becomes usable first while the old seasons trickle in.
 */
export function taskPriority(
	task: { reason: SyncReason; ctx: TaskContext },
	currentYear: number
): number {
	switch (task.reason) {
		case 'manual':
			return 10;
		case 'window':
			return 9;
		case 'daily':
			return 8;
		case 'bootstrap': {
			if (task.ctx.seasonYear === undefined) return 7;
			const age = Math.max(0, currentYear - task.ctx.seasonYear);
			return Math.max(1, 7 - Math.floor(age / 3));
		}
	}
}
