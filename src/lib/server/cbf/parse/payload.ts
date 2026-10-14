import { XMLParser } from 'fast-xml-parser';
import { isRec, type Rec } from './coerce';

export class CbfParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CbfParseError';
	}
}

/** Elements that can repeat in v1 XML / seasonList and must always parse as arrays. */
const XML_ARRAY_TAGS = new Set(['season', 'div', 'phase', 'game', 'ref', 'team', 'partial']);

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	isArray: (name: string) => XML_ARRAY_TAGS.has(name)
});

export type DecodedPayload =
	| { format: 'json'; data: unknown }
	| { format: 'xml'; data: Rec }
	| { format: 'empty'; data: null };

/** Sniffs the body (ČBF does not set content types reliably) and parses JSON or XML. */
export function decodePayload(body: string): DecodedPayload {
	const text = body.trim();
	if (text === '') return { format: 'empty', data: null };
	if (text.startsWith('{') || text.startsWith('[') || text === 'null' || text === 'false') {
		try {
			return { format: 'json', data: JSON.parse(text) };
		} catch (err) {
			throw new CbfParseError(`Invalid JSON: ${(err as Error).message}`);
		}
	}
	if (text.startsWith('<')) {
		if (/^<!doctype html|^<html/i.test(text)) throw new CbfParseError('Got an HTML page');
		try {
			return { format: 'xml', data: xmlParser.parse(text) as Rec };
		} catch (err) {
			throw new CbfParseError(`Invalid XML: ${(err as Error).message}`);
		}
	}
	throw new CbfParseError(
		`Unrecognized payload starting with ${JSON.stringify(text.slice(0, 40))}`
	);
}

/** Content of the XML root element (skipping the <?xml?> declaration). */
export function xmlRoot(data: Rec): Rec {
	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith('?')) continue;
		return isRec(value) ? value : {};
	}
	return {};
}

/**
 * Normalizes PHP-style JSON collections to an array of records: arrays stay arrays, objects whose
 * values are all records (PHP assoc arrays) become their values, a single record becomes [record].
 */
export function asRecordArray(value: unknown): Rec[] {
	if (Array.isArray(value)) return value.filter(isRec);
	if (isRec(value)) {
		const values = Object.values(value);
		if (values.length > 0 && values.every(isRec)) return values as Rec[];
		return [value];
	}
	return [];
}

/** Like asRecordArray but for elements fast-xml-parser may return as one object or a list. */
export function xmlList(value: unknown): Rec[] {
	if (Array.isArray(value)) return value.filter(isRec);
	return isRec(value) ? [value] : [];
}
