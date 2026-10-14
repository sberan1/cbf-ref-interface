/**
 * One-shot `graylog-setup` service (ADR 0009): makes sure Graylog has the GELF UDP input that the
 * Docker daemon ships container logs to, a JSON extractor that turns the app's JSON log lines
 * into fields (prefixed `app_`, so `level` & co. do not clash with the GELF fields), and a disk
 * cap on the default index set. Idempotent.
 */
const api = (process.env.GRAYLOG_API ?? 'http://graylog:9000/api').replace(/\/$/, '');
const password = process.env.GRAYLOG_ROOT_PASSWORD;
const INPUT_TITLE = 'GELF UDP (docker)';
const EXTRACTOR_TITLE = 'JSON log line';
const INDEX_MAX_BYTES = Number(process.env.GRAYLOG_INDEX_MAX_BYTES || 1024 ** 3);
const MAX_INDICES = Number(process.env.GRAYLOG_MAX_INDICES || 20);

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

// Disk cap: the default index set rotates at INDEX_MAX_BYTES and keeps the MAX_INDICES newest.
// Graylog 6 creates it with "data tiering" (rotation by age, 30–40 days, no size limit), which
// ignores the size settings of graylog.conf; the legacy rotation honours them.
const SIZE_ROTATION = 'org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategy';
const DELETE_RETENTION = 'org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy';

interface IndexSet {
	id: string;
	default: boolean;
	use_legacy_rotation: boolean;
	rotation_strategy_class: string;
	rotation_strategy: { max_size?: number };
	retention_strategy_class: string;
	retention_strategy: { max_number_of_indices?: number };
	[field: string]: unknown;
}

const { index_sets: indexSets } = await call<{ index_sets: IndexSet[] }>(
	'GET',
	'/system/indices/index_sets?skip=0&limit=0&stats=false'
);
const target = indexSets.find((s) => s.default);
if (!target) {
	console.log('no default index set yet, disk cap not applied');
} else if (
	target.use_legacy_rotation &&
	target.rotation_strategy_class === SIZE_ROTATION &&
	target.rotation_strategy.max_size === INDEX_MAX_BYTES &&
	target.retention_strategy_class === DELETE_RETENTION &&
	target.retention_strategy.max_number_of_indices === MAX_INDICES
) {
	console.log(`index set "${target.title}" capped (${MAX_INDICES} × ${INDEX_MAX_BYTES} B)`);
} else {
	const keep = [
		'title',
		'description',
		'writable',
		'shards',
		'replicas',
		'index_analyzer',
		'index_optimization_max_num_segments',
		'index_optimization_disabled',
		'field_type_refresh_interval',
		'field_type_profile',
		'data_tiering'
	];
	await call('PUT', `/system/indices/index_sets/${target.id}`, {
		...Object.fromEntries(keep.map((k) => [k, target[k]])),
		use_legacy_rotation: true,
		rotation_strategy_class: SIZE_ROTATION,
		rotation_strategy: {
			type: `${SIZE_ROTATION}Config`,
			max_size: INDEX_MAX_BYTES
		},
		retention_strategy_class: DELETE_RETENTION,
		retention_strategy: {
			type: `${DELETE_RETENTION}Config`,
			max_number_of_indices: MAX_INDICES
		}
	});
	console.log(`index set "${target.title}" capped to ${MAX_INDICES} × ${INDEX_MAX_BYTES} B`);
}
