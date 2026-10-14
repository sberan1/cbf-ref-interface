<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { formatDate, formatKc, formatNumber, formatTime, seasonName } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);

	const t = $derived(data.totals);
	const unfilled = $derived(t.days - t.filled);
</script>

<svelte:head>
	<title>Cesty a náhrady – Rozhodčí ČBF</title>
</svelte:head>

<div class="space-y-6">
	<section class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Cesty a náhrady</h1>
			<p class="mt-1 text-sm text-ink-2">
				Cestovné, stravné a náhrada za všední den po dnech se zápasy. Každý den otevři a uprav, kde
				jsi nabíral a vysazoval kolegy.
			</p>
		</div>
		{#if data.seasons.length > 1}
			<nav aria-label="Sezóna" class="flex flex-wrap gap-1 text-xs">
				{#each data.seasons as s (s)}
					<a
						href={resolve(`/trips?s=${s}`)}
						aria-current={s === data.season ? 'page' : undefined}
						class={[
							'rounded-md border px-2.5 py-1',
							s === data.season
								? 'border-accent bg-accent font-medium text-accent-ink'
								: 'border-line text-ink-2 hover:text-ink'
						]}>{seasonName(s)}</a
					>
				{/each}
			</nav>
		{/if}
	</section>

	{#if !data.hasHome}
		<p class="rounded-md border border-line bg-surface px-4 py-3 text-sm">
			Nejdřív si v <a href={resolve('/profile')} class="text-accent underline">profilu</a> nastav bydliště,
			odkud jezdíš. Bez něj se cesty nedají spočítat.
		</p>
	{:else if !data.mapsLive}
		<p class="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-2">
			Mapy.com nejsou nastavené, vzdálenosti jsou jen odhad vzdušnou čarou (× 1,3).
		</p>
	{/if}

	<section class="grid grid-cols-2 gap-3 sm:grid-cols-5">
		{#each [{ label: 'Cestovné', value: formatKc(t.travel) }, { label: 'Stravné', value: formatKc(t.meal) }, { label: 'Všední den', value: formatKc(t.weekday) }, { label: `Celkem ${seasonName(data.season)}`, value: formatKc(t.total) }, { label: 'Najeto autem', value: `${formatNumber(t.km)} km` }] as tile (tile.label)}
			<div class="rounded-lg border border-line bg-surface px-4 py-3">
				<p class="text-xs text-muted">{tile.label}</p>
				<p class="mt-1 text-xl font-semibold whitespace-nowrap tabular-nums">{tile.value}</p>
			</div>
		{/each}
	</section>

	<div class="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-2">
		<p>
			{t.days} dnů se zápasy: {t.confirmed} potvrzených, {t.filled - t.confirmed} spočítaných automaticky
			(sám autem z domova), {unfilled} nevyplněných.
		</p>
		{#if data.hasHome && unfilled > 0}
			<form
				method="POST"
				action="?/autofill"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						await update({ reset: false });
						busy = false;
					};
				}}
			>
				<input type="hidden" name="season" value={data.season} />
				<button
					disabled={busy}
					class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
				>
					{busy ? 'Počítám trasy…' : 'Spočítat nevyplněné dny (sám autem)'}
				</button>
			</form>
		{/if}
	</div>
	{#if form?.autofill}
		<p class="text-sm text-ink-2" role="status">
			Spočítáno {form.autofill.filled} dnů{form.autofill.remaining
				? `, zbývá ${form.autofill.remaining} (klikni znovu)`
				: ''}.
			{#if form.autofill.failed.length}
				<span class="block text-danger">Nepodařilo se: {form.autofill.failed.join('; ')}</span>
			{/if}
		</p>
	{/if}
	{#if form?.error}<p class="text-sm text-danger" role="alert">{form.error}</p>{/if}

	<ul class="divide-y divide-line rounded-lg border border-line bg-surface">
		{#each data.days as d (d.date)}
			<li class="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
				<div class="min-w-0">
					<p class="text-sm font-medium">
						{formatDate(d.date)}
						{#if d.holiday}<span class="ml-1 text-xs text-muted">{d.holiday}</span>{/if}
						{#if d.upcoming}<span class="ml-1 text-xs text-muted">nadcházející</span>{/if}
					</p>
					{#each d.games as g (g.id)}
						<p class="truncate text-xs text-ink-2">
							{formatTime(g.time)}
							{g.competition ?? 'soutěž?'} · {g.venue || 'hala?'}{g.commissioner
								? ' · komisař'
								: ''}
						</p>
					{/each}
					<p class="mt-0.5 text-xs text-muted">
						{#if d.status === 'confirmed'}
							potvrzeno · {d.summary}
						{:else if d.status === 'auto'}
							automaticky · {d.summary}
						{:else}
							nevyplněno
						{/if}
					</p>
				</div>
				<div class="flex items-center justify-between gap-4 sm:justify-end">
					{#if d.allowance}
						<p class="text-right text-xs text-ink-2 tabular-nums">
							<span class="block text-sm font-semibold whitespace-nowrap text-ink"
								>{d.allowance.estimated || d.status === 'auto' ? '≈ ' : ''}{formatKc(
									d.allowance.total
								)}</span
							>
							{d.allowance.mode === 'car'
								? `${formatNumber(d.allowance.km.alone + d.allowance.km.shared)} km · `
								: ''}stravné {formatKc(d.allowance.meal)}{d.allowance.weekday
								? ` · všední den ${formatKc(d.allowance.weekday)}`
								: ''}
						</p>
					{/if}
					<a
						href={resolve('/trips/[date]', { date: d.date })}
						class="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
						>{d.status === 'confirmed' ? 'Upravit' : 'Vyplnit'}</a
					>
				</div>
			</li>
		{:else}
			<li class="px-4 py-6 text-sm text-muted">V této sezóně nemáš žádné zápasy.</li>
		{/each}
	</ul>
</div>
