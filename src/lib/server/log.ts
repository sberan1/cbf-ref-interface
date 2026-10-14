/**
 * JSON-lines logger shared by the web app, the sync worker and the scheduler. Docker ships stdout
 * and stderr to Graylog over GELF, where the JSON extractor turns the keys into fields (ADR 0009).
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
	// read on every call: the CLI loads .env after this module is imported
	const threshold = order[process.env.LOG_LEVEL as Level] ?? order.info;
	if (order[level] < threshold) return;
	const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
	if (level === 'error' || level === 'warn') console.error(line);
	else console.log(line);
}

export const log = {
	debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
	info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
	warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
	error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields)
};

export type Logger = typeof log;

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
