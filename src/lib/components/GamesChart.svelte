<script lang="ts">
	import type { Granularity, TimelineBucket } from '#lib/referee/timeline.ts';

	interface Props {
		buckets: TimelineBucket[];
		granularity: Granularity;
	}

	let { buckets, granularity }: Props = $props();

	const height = 260;
	const margin = { top: 16, right: 8, bottom: 30, left: 36 };
	const innerH = height - margin.top - margin.bottom;
	const GAP = 2; // surface gap between stacked segments

	let width = $state(720);
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
	const hasFuture = $derived(buckets.some((b) => b.future && b.referee + b.commissioner > 0));

	const y = (v: number) => innerH - (v / yMax) * innerH;

	/** Column with a 4px rounded data-end and a square baseline. */
	function topRounded(x: number, top: number, bottom: number, w: number): string {
		const r = Math.min(4, w / 2, Math.max(0, bottom - top));
		return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
	}

	interface Segment {
		path: string;
		series: 'referee' | 'commissioner';
	}

	const columns = $derived(
		buckets.map((b, i) => {
			const x = i * band + (band - barW) / 2;
			const segments: Segment[] = [];
			const refTop = y(b.referee);
			const total = b.referee + b.commissioner;
			if (b.referee > 0) {
				segments.push({
					series: 'referee',
					path:
						b.commissioner > 0
							? `M${x},${innerH}V${refTop}H${x + barW}V${innerH}Z`
							: topRounded(x, refTop, innerH, barW)
				});
			}
			if (b.commissioner > 0) {
				const bottom = b.referee > 0 ? refTop - GAP : innerH;
				segments.push({ series: 'commissioner', path: topRounded(x, y(total), bottom, barW) });
			}
			return { bucket: b, total, segments };
		})
	);

	const tooltip = $derived.by(() => {
		if (hovered === null || !columns[hovered]) return null;
		const c = columns[hovered];
		const center = margin.left + band * (hovered + 0.5);
		return {
			bucket: c.bucket,
			total: c.total,
			left: Math.min(Math.max(center, 80), Math.max(80, width - 80)),
			top: margin.top + y(c.total) - 8
		};
	});

	const unit = (n: number) => (n === 1 ? 'zápas' : n >= 2 && n <= 4 ? 'zápasy' : 'zápasů');
</script>

<div bind:clientWidth={width}>
	<ul class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
		<li class="flex items-center gap-1.5">
			<svg width="10" height="10" aria-hidden="true"
				><rect width="10" height="10" rx="2" class="fill-referee" /></svg
			>
			rozhodčí
		</li>
		<li class="flex items-center gap-1.5">
			<svg width="10" height="10" aria-hidden="true"
				><rect width="10" height="10" rx="2" class="fill-commissioner" /></svg
			>
			komisař
		</li>
		{#if hasFuture}
			<li class="flex items-center gap-1.5 text-muted">
				<svg width="10" height="10" aria-hidden="true"
					><rect width="10" height="10" rx="2" class="fill-referee" opacity="0.4" /></svg
				>
				světlejší = nadcházející delegace
			</li>
		{/if}
	</ul>

	{#if buckets.length === 0}
		<p class="py-12 text-center text-sm text-muted">Pro toto období nejsou žádné zápasy.</p>
	{:else}
		<div class="relative">
			<svg
				{width}
				{height}
				role="img"
				aria-label="Počet zápasů v čase (data jsou i v tabulce pod grafem)"
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
							class="fill-muted text-[11px] tabular-nums">{t}</text
						>
					{/each}

					{#each columns as c, i (c.bucket.key)}
						<g opacity={c.bucket.future ? 0.4 : 1} class:brightness-110={hovered === i}>
							{#each c.segments as s (s.series)}
								<path
									d={s.path}
									class={s.series === 'referee' ? 'fill-referee' : 'fill-commissioner'}
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
					aria-label={`${c.bucket.label}: ${c.total} ${unit(c.total)}, rozhodčí ${c.bucket.referee}, komisař ${c.bucket.commissioner}`}
					onpointerenter={() => (hovered = i)}
					onpointerleave={() => (hovered = null)}
					onfocus={() => (hovered = i)}
					onblur={() => (hovered = null)}
				></button>
			{/each}

			{#if tooltip}
				<div
					class="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-md"
					style:left={`${tooltip.left}px`}
					style:top={`${tooltip.top}px`}
				>
					<p class="text-muted">
						{tooltip.bucket.label}{tooltip.bucket.future ? ' · nadcházející' : ''}
					</p>
					<p class="mt-0.5 text-sm font-semibold text-ink">{tooltip.total} {unit(tooltip.total)}</p>
					<p class="mt-1 flex items-center gap-2 text-ink-2">
						<span class="inline-block h-0.5 w-3 rounded bg-referee"></span>
						<span class="font-medium text-ink tabular-nums">{tooltip.bucket.referee}</span> rozhodčí
					</p>
					<p class="flex items-center gap-2 text-ink-2">
						<span class="inline-block h-0.5 w-3 rounded bg-commissioner"></span>
						<span class="font-medium text-ink tabular-nums">{tooltip.bucket.commissioner}</span> komisař
					</p>
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
							<th class="py-1 pr-4 text-right font-medium">Rozhodčí</th>
							<th class="py-1 pr-4 text-right font-medium">Komisař</th>
							<th class="py-1 text-right font-medium">Celkem</th>
						</tr>
					</thead>
					<tbody class="tabular-nums">
						{#each columns as c (c.bucket.key)}
							<tr class="border-t border-line">
								<td class="py-1 pr-4">{c.bucket.label}{c.bucket.future ? ' (nadcházející)' : ''}</td
								>
								<td class="py-1 pr-4 text-right">{c.bucket.referee}</td>
								<td class="py-1 pr-4 text-right">{c.bucket.commissioner}</td>
								<td class="py-1 text-right font-medium">{c.total}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
</div>
