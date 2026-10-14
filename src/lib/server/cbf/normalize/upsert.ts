import { getTableColumns, getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

type ColumnKey<T extends PgTable> = Extract<keyof T['_']['columns'], string>;

function columnName<T extends PgTable>(table: T, key: ColumnKey<T>): string {
	return (getTableColumns(table) as Record<string, { name: string }>)[key].name;
}

/** Reference to the incoming row in ON CONFLICT DO UPDATE. */
export function excluded<T extends PgTable>(table: T, key: ColumnKey<T>): SQL {
	return sql.raw(`excluded."${columnName(table, key)}"`);
}

/** Reference to the existing row in ON CONFLICT DO UPDATE. */
export function existing<T extends PgTable>(table: T, key: ColumnKey<T>): SQL {
	return sql.raw(`"${getTableName(table)}"."${columnName(table, key)}"`);
}

/** SET clause: incoming values overwrite. */
export function overwrite<T extends PgTable>(table: T, keys: ColumnKey<T>[]): Record<string, SQL> {
	return Object.fromEntries(keys.map((k) => [k, excluded(table, k)]));
}

/** SET clause: keep the existing value when present, otherwise take the incoming one. */
export function fillMissing<T extends PgTable>(
	table: T,
	keys: ColumnKey<T>[]
): Record<string, SQL> {
	return Object.fromEntries(
		keys.map((k) => [k, sql`coalesce(${existing(table, k)}, ${excluded(table, k)})`])
	);
}

/** SET clause: take the incoming value when present, otherwise keep the existing one. */
export function preferIncoming<T extends PgTable>(
	table: T,
	keys: ColumnKey<T>[]
): Record<string, SQL> {
	return Object.fromEntries(
		keys.map((k) => [k, sql`coalesce(${excluded(table, k)}, ${existing(table, k)})`])
	);
}

export function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

export function uniqueBy<T, K>(items: T[], key: (item: T) => K): T[] {
	const seen = new Map<K, T>();
	for (const item of items) seen.set(key(item), item);
	return [...seen.values()];
}
