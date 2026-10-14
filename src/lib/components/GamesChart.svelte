<script lang="ts">
	import { formatKc, formatNumber } from '#lib/format.ts';
	import type { Granularity, TimelineBucket } from '#lib/referee/timeline.ts';

	interface Props {
		buckets: TimelineBucket[];
		granularity: Granularity;
		/** games: referee + commissioner counts; earnings: Kč in `referee`, assumed part in `estimated` */
		metric?: 'games' | 'earnings';
	}

	let { buckets, granularity, metric = 'games' }: Props = $props();

	const height = 260;
	const margin = $derived({ top: 16, right: 8, bottom: 30, left: metric === 'earnings' ? 52 : 36 });
	const innerH = height - 16 - 30;
	const GAP = 2; // surface gap between stacked segments

	// 0 until measured on the client: the plot is drawn only at its real width (no layout jump)
	let width = $state(0);
	let hovered = $state<number | null>(null);

	function niceTicks(max: number): number[] {
		const raw = Math.max(max, 1) / 4;
		const magnitude = 10 ** Math.floor(Math.log10(raw));
		const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 1);
		const top = Math.max(step, Math.ceil(max / step) * step);
		return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
	}

	const innerW = $derived(Math.max(0, width - margin.left - margin.right));
	const totals = $derived(buckets.map((b) => b.referee + b.commissioner));
	const ticks = $derived(niceTicks(Math.max(0, ...totals)));
	const yMax = $derived(ticks.at(-1) ?? 1);
	const band = $derived(buckets.length ? innerW / buckets.length : 0);
	const barW = $derived(Math.max(2, Math.min(24, band * 0.7)));
	const labelEvery = $derived(
		Math.max(1, Math.ceil((granularity === 'season' ? 56 : 48) / Math.max(band, 1)))
	);
	const hasFuture = $derived(
		buckets.some((b) => (b.future && b.referee + b.commissioner > 0) || (b.expected ?? 0) > 0)
	);

	const y = (v: number) => innerH - (v / yMax) * innerH;

	/** Column with a 4px rounded data-end and a square baseline. */
	function topRounded(x: number, top: number, bottom: number, w: number): string {
		const r = Math.min(4, w / 2, Math.max(0, bottom - top));
		return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
	}

	interface Segment {
		path: string;
		/** `expected`: earnings of upcoming delegations, drawn muted on top of the earned part */
		series: 'referee' | 'commissioner' | 'expected';
	}

	const columns = $derived(
		buckets.map((b, i) => {
			const x = i * band + (band - barW) / 2;
			const segments: Segment[] = [];
			const [lower, upper] = earnings
				? [b.referee - (b.expected ?? 0), b.expected ?? 0]
				: [b.referee, b.commissioner];
			const upperSeries = earnings ? 'expected' : 'commissioner';
			const lowerTop = y(lower);
			const total = lower + upper;
			if (lower > 0) {
				segments.push({
					series: 'referee',
					path:
						upper > 0
							? `M${x},${innerH}V${lowerTop}H${x + barW}V${innerH}Z`
							: topRounded(x, lowerTop, innerH, barW)
				});
			}
			if (upper > 0) {
				const bottom = lower > 0 ? lowerTop - GAP : innerH;
				segments.push({ series: upperSeries, path: topRounded(x, y(total), bottom, barW) });
			}
			return { bucket: b, total, segments };
		})
	);

	/** Tooltip beside the hovered column (right of it, or left near the right edge), inside the plot. */
	const tooltip = $derived.by(() => {
		if (hovered === null || !columns[hovered]) return null;
		const c = columns[hovered];
		const center = margin.left + band * (hovered + 0.5);
		const onRight = center + band / 2 + 180 < width;
		const offset = Math.max(barW / 2 + 6, 8);
		return {
			bucket: c.bucket,
			total: c.total,
			onRight,
			left: onRight ? center + offset : center - offset,
			top: margin.top
		};
	});

	const unit = (n: number) => (n === 1 ? 'zápas' : n >= 2 && n <= 4 ? 'zápasy' : 'zápasů');
	const earnings = $derived(metric === 'earnings');
	const tickLabel = (t: number) =>
		earnings && t >= 1000 ? `${formatNumber(t / 1000)} tis.` : formatNumber(t);
	const valueText = (n: number) => (earnings ? formatKc(n) : `${n} ${unit(n)}`);
	function columnLabel(b: TimelineBucket, total: number): string {
		if (earnings) {
			const exp = b.expected ? `, z toho očekáváno ${formatKc(b.expected)}` : '';
			const est = b.estimated ? `, odhadem ${formatKc(b.estimated)}` : '';
			return `${b.label}: ${formatKc(total)}${exp}${est}`;
		}
		return `${b.label}: ${total} ${unit(total)}, rozhodčí ${b.referee}, komisař ${b.commissioner}`;
	}
</script>

<div bind:clientWidth={width}>
	<ul class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
		<li class="flex items-center gap-1.5">
			<svg width="10" height="10" aria-hidden="true"
				><rect width="10" height="10" rx="2" class="fill-referee" /></svg
			>
			{earnings ? 'odměna za řízení' : 'rozhodčí'}
		</li>
		{#if !earnings}
			<li class="flex items-center gap-1.5">
				<svg width="10" height="10" aria-hidden="true"
					><rect width="10" height="10" rx="2" class="fill-commissioner" /></svg
				>
				komisař
			</li>
		{/if}
		{#if hasFuture}
			<li class="flex items-center gap-1.5 text-muted">
				<svg width="10" height="10" aria-hidden="true"
					><rect width="10" height="10" rx="2" class="fill-referee" opacity="0.4" /></svg
				>
				{earnings
					? 'tlumeně = očekáváno z nadcházejících delegací'
					: 'tlumeně = nadcházející delegace'}
			</li>
		{/if}
	</ul>

	{#if buckets.length === 0}
		<p class="py-12 text-center text-sm text-muted">
			{earnings ? 'Pro toto období nejsou žádné odměny.' : 'Pro toto období nejsou žádné zápasy.'}
		</p>
	{:else if width === 0}
		<div style:height={`${height}px`}></div>
	{:else}
		<div class="relative">
			<svg
				{width}
				{height}
				role="img"
				aria-label={earnings
					? 'Odměny v čase (data jsou i v tabulce pod grafem)'
					: 'Počet zápasů v čase (data jsou i v tabulce pod grafem)'}
				class="block overflow-visible"
			>
				<g transform={`translate(${margin.left},${margin.top})`}>
					{#each ticks as t (t)}
						<line
							x1="0"
							x2={innerW}
							y1={y(t)}
							y2={y(t)}
							class={t === 0 ? 'stroke-axis' : 'stroke-grid'}
							stroke-width="1"
							shape-rendering="crispEdges"
						/>
						<text
							x="-8"
							y={y(t)}
							dy="0.32em"
							text-anchor="end"
							class="fill-muted text-[11px] tabular-nums">{tickLabel(t)}</text
						>
					{/each}

					{#each columns as c, i (c.bucket.key)}
						<g opacity={c.bucket.future ? 0.4 : 1} class:brightness-110={hovered === i}>
							{#each c.segments as s (s.series)}
								<path
									d={s.path}
									class={s.series === 'commissioner' ? 'fill-commissioner' : 'fill-referee'}
									opacity={s.series === 'expected' && !c.bucket.future ? 0.4 : undefined}
								/>
							{/each}
						</g>
						{#if i % labelEvery === 0}
							<text
								x={i * band + band / 2}
								y={innerH + 18}
								text-anchor="middle"
								class="fill-muted text-[11px] tabular-nums">{c.bucket.label}</text
							>
						{/if}
					{/each}
				</g>
			</svg>

			<!-- hit targets: one focusable button per column covering its whole band, not just the bar -->
			{#each columns as c, i (c.bucket.key)}
				<button
					type="button"
					class="absolute cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
					style:left={`${margin.left + i * band}px`}
					style:top={`${margin.top}px`}
					style:width={`${band}px`}
					style:height={`${innerH}px`}
					aria-label={columnLabel(c.bucket, c.total)}
					onpointerenter={() => (hovered = i)}
					onpointerleave={() => (hovered = null)}
					onfocus={() => (hovered = i)}
					onblur={() => (hovered = null)}
				></button>
			{/each}

			{#if tooltip}
				<div
					class={[
						'pointer-events-none absolute z-10 min-w-36 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-md',
						!tooltip.onRight && '-translate-x-full'
					]}
					style:left={`${tooltip.left}px`}
					style:top={`${tooltip.top}px`}
				>
					<p class="text-muted">
						{tooltip.bucket.label}{tooltip.bucket.future ? ' · nadcházející' : ''}
					</p>
					<p class="mt-0.5 text-sm font-semibold text-ink tabular-nums">
						{valueText(tooltip.total)}
					</p>
					{#if earnings}
						{#if tooltip.bucket.expected && tooltip.bucket.expected < tooltip.total}
							<p class="mt-1 text-ink-2">
								vyděláno <span class="font-medium text-ink tabular-nums"
									>{formatKc(tooltip.total - tooltip.bucket.expected)}</span
								>
							</p>
							<p class="text-ink-2">
								očekáváno <span class="font-medium text-ink tabular-nums"
									>{formatKc(tooltip.bucket.expected)}</span
								>
							</p>
						{/if}
						{#if tooltip.bucket.estimated}
							<p class="mt-1 text-ink-2">
								z toho odhad <span class="font-medium text-ink tabular-nums"
									>{formatKc(tooltip.bucket.estimated)}</span
								>
							</p>
						{/if}
					{:else}
						<p class="mt-1 flex items-center gap-2 text-ink-2">
							<span class="inline-block h-0.5 w-3 rounded bg-referee"></span>
							<span class="font-medium text-ink tabular-nums">{tooltip.bucket.referee}</span> rozhodčí
						</p>
						<p class="flex items-center gap-2 text-ink-2">
							<span class="inline-block h-0.5 w-3 rounded bg-commissioner"></span>
							<span class="font-medium text-ink tabular-nums">{tooltip.bucket.commissioner}</span> komisař
						</p>
					{/if}
				</div>
			{/if}
		</div>

		<details class="mt-3 text-sm">
			<summary class="cursor-pointer text-xs text-muted hover:text-ink"
				>Zobrazit jako tabulku</summary
			>
			<div class="mt-2 max-h-64 overflow-auto">
				<table class="w-full text-left text-xs">
					<thead class="text-muted">
						<tr>
							<th class="py-1 pr-4 font-medium">Období</th>
							{#if earnings}
								<th class="py-1 pr-4 text-right font-medium">Odměna</th>
								<th class="py-1 pr-4 text-right font-medium">z toho očekáváno</th>
								<th class="py-1 text-right font-medium">z toho odhad</th>
							{:else}
								<th class="py-1 pr-4 text-right font-medium">Rozhodčí</th>
								<th class="py-1 pr-4 text-right font-medium">Komisař</th>
								<th class="py-1 text-right font-medium">Celkem</th>
							{/if}
						</tr>
					</thead>
					<tbody class="tabular-nums">
						{#each columns as c (c.bucket.key)}
							<tr class="border-t border-line">
								<td class="py-1 pr-4">{c.bucket.label}{c.bucket.future ? ' (nadcházející)' : ''}</td
								>
								{#if earnings}
									<td class="py-1 pr-4 text-right font-medium whitespace-nowrap"
										>{formatKc(c.total)}</td
									>
									<td class="py-1 pr-4 text-right whitespace-nowrap"
										>{formatKc(c.bucket.expected ?? 0)}</td
									>
									<td class="py-1 text-right whitespace-nowrap"
										>{formatKc(c.bucket.estimated ?? 0)}</td
									>
								{:else}
									<td class="py-1 pr-4 text-right">{c.bucket.referee}</td>
									<td class="py-1 pr-4 text-right">{c.bucket.commissioner}</td>
									<td class="py-1 text-right font-medium">{c.total}</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</div>
