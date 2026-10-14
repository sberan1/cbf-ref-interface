/**
 * Discovery: downloads a small, rate-limited sample of every v1/v2 endpoint (current + one old
 * season, areas probe) and writes the bodies plus an inferred schema summary to disk. Needs no DB
 * or RabbitMQ. Purpose: verify the assumptions in parse/v1.ts, parse/v2.ts (ADR 0001 open questions).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { endpoints, normalizeParams, type EndpointDef, type EndpointKey } from '../endpoints';
import { CbfHttpError, type CbfHttpClient } from '../http';
import { errorMessage, log } from '../log';
import { decodePayload } from '../parse/payload';
import { parseV2Divs, parseV2Games, parseV2Phases } from '../parse/v2';
import type { ParsedGame } from '../parse/types';
import { describeShape, type ShapeSummary } from './shape';

export interface DiscoveryOptions {
	http: CbfHttpClient;
	outDir: string;
	years: number[];
	probeAreas: number[];
}

interface SampleRecord {
	file: string | null;
	endpoint: string;
	url: string;
	status: number | null;
	bytes: number;
	format: string;
	error?: string;
	shape?: ShapeSummary;
}

export async function runDiscovery(opts: DiscoveryOptions) {
	await mkdir(opts.outDir, { recursive: true });
	const samples: SampleRecord[] = [];
	let counter = 0;

	async function sample(
		key: EndpointKey | `${EndpointKey}+json`,
		params: Record<string, string | number> = {}
	): Promise<string | null> {
		const baseKey = key.replace('+json', '') as EndpointKey;
		const def: EndpointDef = key.endsWith('+json')
			? { ...endpoints[baseKey], fixed: { json: '1' } }
			: endpoints[baseKey];
		const p = normalizeParams(def, params);
		const url = opts.http.url(def, p);
		const name = [key, ...Object.entries(p).map(([k, v]) => `${k}-${v}`)].join('_');
		try {
			const res = await opts.http.get(def, p);
			let format = 'unknown';
			let shape: ShapeSummary | undefined;
			try {
				const decoded = decodePayload(res.body);
				format = decoded.format;
				shape = describeShape(decoded.data);
			} catch (err) {
				format = `unparseable: ${errorMessage(err)}`;
			}
			const ext = format === 'xml' ? 'xml' : format === 'json' ? 'json' : 'txt';
			const file = `${String(++counter).padStart(3, '0')}_${name}.${ext}`;
			await writeFile(join(opts.outDir, file), res.body);
			samples.push({
				file,
				endpoint: key,
				url,
				status: res.status,
				bytes: res.byteSize,
				format,
				shape
			});
			log.info('sampled', { key, params: p, status: res.status, bytes: res.byteSize, format });
			return res.status === 200 ? res.body : null;
		} catch (err) {
			const status = err instanceof CbfHttpError ? (err.status ?? null) : null;
			samples.push({
				file: null,
				endpoint: key,
				url,
				status,
				bytes: 0,
				format: 'error',
				error: errorMessage(err)
			});
			log.warn('sample failed', { key, params: p, err: errorMessage(err) });
			if (err instanceof CbfHttpError && err.kind === 'blocked') throw err;
			return null;
		}
	}

	const safe = <T>(fn: () => T, fallback: T): T => {
		try {
			return fn();
		} catch {
			return fallback;
		}
	};

	await sample('v2.seasonList');
	await sample('v2.seasonList+json');

	for (const [i, year] of opts.years.entries()) {
		await sample('v1.divs', { s: year });
		await sample('v2.divs', { season: year, female: 1, area: 0 });
		const divsBody = await sample('v2.divs', { season: year, female: 0, area: 0 });
		const competitions = divsBody ? safe(() => parseV2Divs(divsBody), []) : [];

		if (i === 0) {
			for (const area of opts.probeAreas) {
				await sample('v2.divs', { season: year, female: 0, area });
			}
		}

		const competition = competitions.find((c) => /nbl|liga/i.test(c.name ?? '')) ?? competitions[0];
		if (!competition) continue;
		const phasesBody = await sample('v2.phases', { competition: competition.id });
		const phase = phasesBody ? safe(() => parseV2Phases(phasesBody), [])[0] : undefined;
		if (!phase) continue;

		const gamesBody = await sample('v2.games', { phase: phase.id });
		await sample('v2.table', { phase: phase.id });
		await sample('v1.sched', { p: phase.id });
		await sample('v1.table', { p: phase.id });

		const games: ParsedGame[] = gamesBody ? safe(() => parseV2Games(gamesBody), []) : [];
		const played = games.find((g) => g.homeScore !== null) ?? games[0];
		const upcoming = games.find((g) => g.startsAt && g.startsAt.getTime() > Date.now());
		for (const g of [played, upcoming].filter((x): x is ParsedGame => !!x)) {
			await sample('v2.game', { game: g.id });
		}
		const teamId = played?.home.id;
		if (teamId) {
			await sample('v2.team', { id: teamId, competition: competition.id });
			await sample('v2.teamplayers', { id: teamId, competition: competition.id });
		}
	}

	const summaryFile = join(opts.outDir, 'summary.json');
	await writeFile(summaryFile, JSON.stringify({ generatedAt: new Date(), samples }, null, 2));
	return { summaryFile, samples };
}
