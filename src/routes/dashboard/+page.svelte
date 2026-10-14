<script lang="ts">
	import GameList from '#lib/components/GameList.svelte';
	import GamesChart from '#lib/components/GamesChart.svelte';
	import { formatDate, formatNumber, seasonName } from '#lib/format.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const views = [
		{ key: 'season', label: 'Sezóny' },
		{ key: 'month', label: 'Měsíce (2 roky)' },
		{ key: 'week', label: 'Týdny (půl roku)' }
	] as const;

	const s = $derived(data.summary);
	const tiles = $derived([
		{ label: `Sezóna ${seasonName(data.currentSeasonYear)}`, value: s.currentSeason },
		{ label: 'Jako rozhodčí', value: s.asReferee },
		{ label: 'Jako komisař', value: s.asCommissioner },
		{ label: 'Nadcházející delegace', value: s.upcoming },
		{ label: 'Sezón', value: s.seasons },
		{ label: 'Soutěží', value: s.competitions }
	]);
</script>

<svelte:head>
	<title>Přehled – Rozhodčí ČBF</title>
</svelte:head>

<div class="space-y-6">
	<section class="flex flex-wrap items-end justify-between gap-6">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">
				{data.user?.firstName}
				{data.user?.lastName}
			</h1>
			<p class="mt-1 text-sm text-ink-2">
				{#if s.firstGame}
					Zápasy v datech od {formatDate(s.firstGame)}, poslední odehraný {formatDate(
						s.lastPlayedGame
					)}.
				{:else}
					Zatím žádné zápasy v datech.
				{/if}
			</p>
		</div>
		<div class="text-right">
			<p class="text-xs text-muted">Zápasů celkem</p>
			<p class="text-5xl font-semibold tracking-tight">{formatNumber(s.total)}</p>
		</div>
	</section>

	<section class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
		{#each tiles as t (t.label)}
			<div class="rounded-lg border border-line bg-surface px-4 py-3">
				<p class="text-xs text-muted">{t.label}</p>
				<p class="mt-1 text-xl font-semibold">{formatNumber(t.value)}</p>
			</div>
		{/each}
	</section>

	<section class="rounded-lg border border-line bg-surface p-4">
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-sm font-semibold">Počet zápasů v čase</h2>
			<nav aria-label="Období grafu" class="flex rounded-md border border-line p-0.5 text-xs">
				{#each views as v (v.key)}
					<a
						href={resolve(`/dashboard?g=${v.key}`)}
						data-sveltekit-noscroll
						aria-current={data.granularity === v.key ? 'page' : undefined}
						class={[
							'rounded px-3 py-1.5',
							data.granularity === v.key
								? 'bg-accent font-medium text-accent-ink'
								: 'text-ink-2 hover:bg-page hover:text-ink'
						]}>{v.label}</a
					>
				{/each}
			</nav>
		</div>
		<GamesChart buckets={data.timeline} granularity={data.granularity} />
	</section>

	<div class="grid gap-6 lg:grid-cols-2">
		<GameList
			title="Nejbližší delegace"
			games={data.upcoming}
			empty="Žádné nadcházející delegace. ČBF zveřejňuje rozhodčí často až krátce před zápasem."
		/>
		<GameList title="Poslední zápasy" games={data.recent} empty="Žádné odehrané zápasy." />
	</div>

	<div class="grid gap-6 lg:grid-cols-3">
		<section class="rounded-lg border border-line bg-surface lg:col-span-2">
			<h2 class="border-b border-line px-4 py-3 text-sm font-semibold">Nejčastější soutěže</h2>
			{#if data.competitions.length === 0}
				<p class="px-4 py-6 text-sm text-muted">Žádné soutěže.</p>
			{:else}
				<table class="w-full text-left text-sm">
					<thead class="text-xs text-muted">
						<tr>
							<th class="px-4 py-2 font-medium">Soutěž</th>
							<th class="px-4 py-2 font-medium">Sezóna</th>
							<th class="px-4 py-2 text-right font-medium">Rozhodčí</th>
							<th class="px-4 py-2 text-right font-medium">Komisař</th>
						</tr>
					</thead>
					<tbody class="tabular-nums">
						{#each data.competitions as c (`${c.competitionId}:${c.seasonYear}`)}
							<tr class="border-t border-line">
								<td class="px-4 py-2">{c.name ?? 'neznámá soutěž'}</td>
								<td class="px-4 py-2 text-ink-2">{seasonName(c.seasonYear)}</td>
								<td class="px-4 py-2 text-right">{c.referee}</td>
								<td class="px-4 py-2 text-right">{c.commissioner}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section class="rounded-lg border border-line bg-surface">
			<h2 class="border-b border-line px-4 py-3 text-sm font-semibold">Nejčastější kolegové</h2>
			{#if data.colleagues.length === 0}
				<p class="px-4 py-6 text-sm text-muted">Zatím nikdo.</p>
			{:else}
				<ul class="divide-y divide-line text-sm">
					{#each data.colleagues as c (c.officialId)}
						<li class="flex items-center justify-between px-4 py-2">
							<span>{c.firstName} {c.lastName}</span>
							<span class="text-ink-2 tabular-nums">{c.games}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>
