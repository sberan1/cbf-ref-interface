<script lang="ts">
	import GameList from '#lib/components/GameList.svelte';
	import { formatKc, formatNumber, seasonName } from '#lib/format.ts';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const s = $derived(data.stats);
	const span = $derived(
		s.seasons.length === 0
			? null
			: s.seasons.length === 1
				? seasonName(s.seasons[0])
				: `${seasonName(s.seasons[0])} – ${seasonName(s.seasons[s.seasons.length - 1])}`
	);
	const gamesLabel = (n: number) =>
		`${formatNumber(n)} ${n === 1 ? 'zápas' : n >= 2 && n <= 4 ? 'zápasy' : 'zápasů'}`;
</script>

<svelte:head>
	<title>{data.title} – Rozhodčí ČBF</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a href={resolve('/dashboard')} class="text-sm text-ink-2 hover:text-ink">← Přehled</a>
		<h1 class="mt-2 text-2xl font-semibold tracking-tight">{data.title}</h1>
		<p class="mt-1 text-sm text-ink-2">
			{data.kind === 'colleague' ? 'Společně' : 'Tvoje zápasy tohoto týmu'}: {gamesLabel(
				s.games
			)}{s.commissioner
				? ` (${formatNumber(s.referee)} jako rozhodčí, ${formatNumber(s.commissioner)} jako komisař)`
				: ''}{span ? ` · ${span}` : ''}{s.earned ? ` · odměny ${formatKc(s.earned)}` : ''}
		</p>
		{#if data.season !== null || data.area !== null}
			<p class="mt-1 text-xs text-muted">
				Jen {data.season !== null ? `sezóna ${seasonName(data.season)}` : ''}{data.season !==
					null && data.area !== null
					? ', '
					: ''}{data.area !== null
					? data.area === 0
						? 'celostátní soutěže'
						: `oblast ${data.area}`
					: ''} podle filtru na přehledu.
			</p>
		{/if}
	</div>

	{#if data.upcoming.length > 0}
		<GameList title="Nadcházející" games={data.upcoming} empty="" />
	{/if}
	<GameList title="Odehrané" games={data.played} empty="Žádné odehrané zápasy." />
</div>
