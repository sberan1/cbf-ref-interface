/** Infers a merged structural summary of JSON-like data (keys, types, examples, null counts). */
interface ShapeAcc {
	seen: number;
	types: Set<string>;
	examples: Set<string>;
	keys?: Map<string, ShapeAcc>;
	items?: ShapeAcc;
	minLength?: number;
	maxLength?: number;
}

export interface ShapeSummary {
	types: string[];
	seen: number;
	examples?: string[];
	length?: [number, number];
	keys?: Record<string, ShapeSummary>;
	items?: ShapeSummary;
}

const MAX_EXAMPLES = 3;

const newAcc = (): ShapeAcc => ({ seen: 0, types: new Set(), examples: new Set() });

function typeOf(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	if (typeof value === 'string') {
		if (value === '') return 'string(empty)';
		if (/^-?\d+$/.test(value)) return 'string(int)';
		if (/^-?\d+[.,]\d+$/.test(value)) return 'string(float)';
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'string(date)';
		if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return 'string(time)';
	}
	return typeof value;
}

function observe(acc: ShapeAcc, value: unknown) {
	acc.seen++;
	const type = typeOf(value);
	acc.types.add(type);
	if (Array.isArray(value)) {
		acc.minLength = Math.min(acc.minLength ?? value.length, value.length);
		acc.maxLength = Math.max(acc.maxLength ?? value.length, value.length);
		acc.items ??= newAcc();
		for (const item of value) observe(acc.items, item);
	} else if (type === 'object') {
		acc.keys ??= new Map();
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			let childAcc = acc.keys.get(key);
			if (!childAcc) acc.keys.set(key, (childAcc = newAcc()));
			observe(childAcc, child);
		}
	} else if (value !== null && value !== '' && acc.examples.size < MAX_EXAMPLES) {
		acc.examples.add(String(value).slice(0, 60));
	}
}

function summarize(acc: ShapeAcc): ShapeSummary {
	const out: ShapeSummary = { types: [...acc.types].sort(), seen: acc.seen };
	if (acc.examples.size) out.examples = [...acc.examples];
	if (acc.minLength !== undefined) out.length = [acc.minLength, acc.maxLength ?? acc.minLength];
	if (acc.keys) {
		out.keys = Object.fromEntries([...acc.keys].map(([k, v]) => [k, summarize(v)]));
	}
	if (acc.items) out.items = summarize(acc.items);
	return out;
}

export function describeShape(value: unknown): ShapeSummary {
	const acc = newAcc();
	observe(acc, value);
	return summarize(acc);
}
