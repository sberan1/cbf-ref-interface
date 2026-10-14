<script lang="ts">
	import GameList from '#lib/components/GameList.svelte';
	import GamesChart from '#lib/components/GamesChart.svelte';
	import { formatDate, formatKc, formatNumber, seasonName } from '#lib/format.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const views = [
		{ key: 'season', label: 'Sezóny' },
		{ key: 'month', label: 'Měsíce (2 roky)' },
		{ key: 'week', label: 'Týdny (půl roku)' }
	] as const;
	const metrics = [
		{ key: 'games', label: 'Zápasy', param: '' },
		{ key: 'earnings', label: 'Odměny', param: '&m=kc' }
	] as const;
	const metricParam = $derived(data.metric === 'earnings' ? '&m=kc' : '');
	const e = $derived(data.earnings);

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
			<h2 class="text-sm font-semibold">
				{data.metric === 'earnings' ? 'Odměny za řízení v čase' : 'Počet zápasů v čase'}
			</h2>
			<div class="flex flex-wrap gap-2">
				<nav aria-label="Co graf ukazuje" class="flex rounded-md border border-line p-0.5 text-xs">
					{#each metrics as m (m.key)}
						<a
							href={resolve(`/dashboard?g=${data.granularity}${m.param}`)}
							data-sveltekit-reset="false"
							aria-current={data.metric === m.key ? 'page' : undefined}
							class={[
								'rounded px-3 py-1.5',
								data.metric === m.key
									? 'bg-accent font-medium text-accent-ink'
									: 'text-ink-2 hover:bg-page hover:text-ink'
							]}>{m.label}</a
						>
					{/each}
				</nav>
				<nav aria-label="Období grafu" class="flex rounded-md border border-line p-0.5 text-xs">
					{#each views as v (v.key)}
						<a
							href={resolve(`/dashboard?g=${v.key}${metricParam}`)}
							data-sveltekit-reset="false"
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
		</div>
		<GamesChart buckets={data.timeline} granularity={data.granularity} metric={data.metric} />
	</section>

	<section class="rounded-lg border border-line bg-surface">
		<div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
			<h2 class="text-sm font-semibold">Odměny za řízení</h2>
			<p class="text-xs text-muted">
				Odměna za utkání podle sazebníků, bez cestovného, stravného a příplatků za všední den.
			</p>
		</div>
		<div class="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
			<div>
				<p class="text-xs text-muted">Vyděláno celkem</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums">{formatKc(e.earned)}</p>
				<p class="text-xs text-muted">{formatNumber(e.paidGames)} odřízených zápasů</p>
			</div>
			<div>
				<p class="text-xs text-muted">Sezóna {seasonName(data.currentSeasonYear)}</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums">{formatKc(e.currentSeason)}</p>
			</div>
			<div>
				<p class="text-xs text-muted">Očekáváno z nadcházejících delegací</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums">{formatKc(e.upcoming)}</p>
			</div>
			<div>
				<p class="text-xs text-muted">Zápasy bez sazby</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(e.unratedGames)}</p>
				<p class="text-xs text-muted">nezapočtené</p>
			</div>
		</div>
		{#if e.estimated > 0}
			<p class="px-4 pb-3 text-xs text-ink-2">
				Z toho {formatKc(e.estimated)} podle odhadnutých sazeb (v seznamech zápasů označené ≈): období,
				ke kterým přehled odměn nemáme (ČBF před 2023/24, Praha 2020–2023), a soutěže, u kterých zařazení
				do sazebníku odhadujeme.
			</p>
		{/if}

		{#if e.seasons.length > 0}
			<div class="overflow-x-auto border-t border-line">
				<table class="w-full text-left text-sm">
					<thead class="text-xs text-muted">
						<tr>
							<th class="px-4 py-2 font-medium">Sezóna</th>
							<th class="px-4 py-2 text-right font-medium">Zápasů</th>
							<th class="px-4 py-2 text-right font-medium">Vyděláno</th>
							<th class="hidden px-4 py-2 text-right font-medium sm:table-cell">z toho odhad</th>
							<th class="px-4 py-2 text-right font-medium">Očekáváno</th>
							<th class="hidden px-4 py-2 text-right font-medium sm:table-cell">Bez sazby</th>
						</tr>
					</thead>
					<tbody class="tabular-nums">
						{#each e.seasons as row (row.seasonYear)}
							<tr class="border-t border-line">
								<td class="px-4 py-2">{seasonName(row.seasonYear)}</td>
								<td class="px-4 py-2 text-right">{formatNumber(row.paidGames)}</td>
								<td class="px-4 py-2 text-right font-medium whitespace-nowrap"
									>{row.paidGames ? formatKc(row.earned) : '—'}</td
								>
								<td class="hidden px-4 py-2 text-right whitespace-nowrap text-ink-2 sm:table-cell"
									>{row.estimated ? formatKc(row.estimated) : '—'}</td
								>
								<td class="px-4 py-2 text-right whitespace-nowrap text-ink-2"
									>{row.upcoming ? formatKc(row.upcoming) : '—'}</td
								>
								<td class="hidden px-4 py-2 text-right text-ink-2 sm:table-cell"
									>{row.unrated || '—'}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if e.unrated.length > 0}
			<details class="border-t border-line px-4 py-3 text-sm">
				<summary class="cursor-pointer text-xs text-muted hover:text-ink">
					Soutěže bez sazby ({formatNumber(e.unratedGames)} zápasů)
				</summary>
				<ul class="mt-2 divide-y divide-line">
					{#each e.unrated as u (`${u.competitionName}:${u.seasonYear}:${u.reason}`)}
						<li class="flex items-baseline justify-between gap-3 py-1.5">
							<span>
								{u.competitionName ?? 'neznámá soutěž'}
								<span class="text-ink-2">{seasonName(u.seasonYear)}</span>
								<span class="block text-xs text-muted">{u.reason}</span>
							</span>
							<span class="shrink-0 text-ink-2 tabular-nums">{u.games}</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
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
