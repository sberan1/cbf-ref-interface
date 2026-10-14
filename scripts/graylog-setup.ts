/**
 * One-shot `graylog-setup` service (ADR 0009): makes sure Graylog has the GELF UDP input that the
 * Docker daemon ships container logs to, and a JSON extractor that turns the app's JSON log lines
 * into fields (prefixed `app_`, so `level` & co. do not clash with the GELF fields). Idempotent.
 */
const api = (process.env.GRAYLOG_API ?? 'http://graylog:9000/api').replace(/\/$/, '');
const password = process.env.GRAYLOG_ROOT_PASSWORD;
const INPUT_TITLE = 'GELF UDP (docker)';
const EXTRACTOR_TITLE = 'JSON log line';

if (!password) {
	console.error('GRAYLOG_ROOT_PASSWORD is not set');
	process.exit(1);
}
const auth = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${api}${path}`, {
		method,
		headers: {
			authorization: auth,
			accept: 'application/json',
			'content-type': 'application/json',
			'x-requested-by': 'cbf-ref-graylog-setup'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
	return (await res.json()) as T;
}

async function waitForApi(timeoutMs = 10 * 60_000) {
	const until = Date.now() + timeoutMs;
	for (;;) {
		try {
			const res = await fetch(`${api}/system/lbstatus`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		if (Date.now() > until) throw new Error(`Graylog API ${api} not reachable`);
		await new Promise((r) => setTimeout(r, 5000));
	}
}

interface Input {
	id: string;
	title: string;
}
interface Extractor {
	id: string;
	title: string;
}

await waitForApi();

const { inputs } = await call<{ inputs: Input[] }>('GET', '/system/inputs');
let inputId = inputs.find((i) => i.title === INPUT_TITLE)?.id;
if (inputId) {
	console.log(`input "${INPUT_TITLE}" exists (${inputId})`);
} else {
	const created = await call<{ id: string }>('POST', '/system/inputs', {
		title: INPUT_TITLE,
		type: 'org.graylog2.inputs.gelf.udp.GELFUDPInput',
		global: true,
		configuration: {
			bind_address: '0.0.0.0',
			port: 12201,
			recv_buffer_size: 262144,
			number_worker_threads: 2,
			decompress_size_limit: 8388608,
			charset_name: 'UTF-8'
		}
	});
	inputId = created.id;
	console.log(`input "${INPUT_TITLE}" created (${inputId})`);
}

const { extractors } = await call<{ extractors: Extractor[] }>(
	'GET',
	`/system/inputs/${inputId}/extractors`
);
if (extractors.some((e) => e.title === EXTRACTOR_TITLE)) {
	console.log(`extractor "${EXTRACTOR_TITLE}" exists`);
} else {
	await call('POST', `/system/inputs/${inputId}/extractors`, {
		title: EXTRACTOR_TITLE,
		cursor_strategy: 'copy',
		source_field: 'message',
		target_field: '',
		extractor_type: 'json',
		extractor_config: {
			flatten: false,
			list_separator: ', ',
			kv_separator: '=',
			key_prefix: 'app_',
			key_separator: '_',
			replace_key_whitespace: false,
			key_whitespace_replacement: '_'
		},
		converters: [],
		condition_type: 'regex',
		condition_value: '^\\{',
		order: 0
	});
	console.log(`extractor "${EXTRACTOR_TITLE}" created`);
}
