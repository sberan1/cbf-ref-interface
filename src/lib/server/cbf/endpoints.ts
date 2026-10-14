/**
 * Registry of ČBF export endpoints. Sources: https://cbf.cz.basketball/xml-exporty/p58 (v1) and the
 * public clients jknetl/CzechBasketballSchedule, ivosu/cbf_ical (v2). Live API not verified yet,
 * see docs/agent-context/history/20260923-analyza-cbf-exportu.md.
 */
export type Source = 'v1' | 'v2';

export const endpointKeys = [
	'v2.seasonList',
	'v2.divs',
	'v2.phases',
	'v2.games',
	'v2.game',
	'v2.table',
	'v2.team',
	'v2.teamplayers',
	'v1.divs',
	'v1.sched',
	'v1.table'
] as const;

export type EndpointKey = (typeof endpointKeys)[number];

export interface EndpointDef {
	key: EndpointKey;
	source: Source;
	/** Path relative to CBF_BASE_URL (https://www.cbf.cz/xml/). */
	path: string;
	/** Variable parameters, all required. */
	params: readonly string[];
	/** Constant query parameters (not part of the request key). */
	fixed: Readonly<Record<string, string>>;
}

const v2 = (key: EndpointKey, path: string, params: string[]): EndpointDef => ({
	key,
	source: 'v2',
	path: `api/${path}`,
	params,
	fixed: { json: '1' }
});

const v1 = (key: EndpointKey, path: string, params: string[]): EndpointDef => ({
	key,
	source: 'v1',
	path,
	params,
	fixed: {}
});

export const endpoints: Record<EndpointKey, EndpointDef> = {
	// ivosu/cbf_ical reads seasonList as XML without json=1; the parser accepts both formats.
	'v2.seasonList': { ...v2('v2.seasonList', 'seasonList.php', []), fixed: {} },
	'v2.divs': v2('v2.divs', 'divs.php', ['season', 'female', 'area']),
	'v2.phases': v2('v2.phases', 'phases.php', ['competition']),
	'v2.games': v2('v2.games', 'games.php', ['phase']),
	'v2.game': v2('v2.game', 'game.php', ['game']),
	'v2.table': v2('v2.table', 'table.php', ['phase']),
	'v2.team': v2('v2.team', 'team.php', ['id', 'competition']),
	'v2.teamplayers': v2('v2.teamplayers', 'teamplayers.php', ['id', 'competition']),
	'v1.divs': v1('v1.divs', 'divs.php', ['s']),
	'v1.sched': v1('v1.sched', 'sched.php', ['p']),
	'v1.table': v1('v1.table', 'table.php', ['p'])
};

export function isEndpointKey(value: string): value is EndpointKey {
	return (endpointKeys as readonly string[]).includes(value);
}

export type Params = Record<string, string>;

/** Validates and stringifies params against the endpoint definition. */
export function normalizeParams(def: EndpointDef, params: Record<string, string | number>): Params {
	const out: Params = {};
	for (const name of def.params) {
		const value = params[name];
		if (value === undefined || value === '') {
			throw new Error(`${def.key}: missing parameter "${name}"`);
		}
		out[name] = String(value);
	}
	const unknown = Object.keys(params).filter((p) => !def.params.includes(p));
	if (unknown.length) throw new Error(`${def.key}: unknown parameters ${unknown.join(', ')}`);
	return out;
}

/** Canonical identity of a remote resource, e.g. `v2:api/game.php?game=273093`. */
export function requestKey(def: EndpointDef, params: Params): string {
	const query = [...def.params]
		.sort()
		.map((name) => `${name}=${encodeURIComponent(params[name])}`)
		.join('&');
	return `${def.source}:${def.path}${query ? `?${query}` : ''}`;
}

export function buildUrl(baseUrl: string, def: EndpointDef, params: Params): string {
	const url = new URL(def.path, baseUrl);
	for (const name of def.params) url.searchParams.set(name, params[name]);
	for (const [name, value] of Object.entries(def.fixed)) url.searchParams.set(name, value);
	return url.toString();
}
