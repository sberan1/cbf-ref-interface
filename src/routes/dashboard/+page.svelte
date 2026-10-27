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
	const al = $derived(data.allowances);
	// calendar years with fees or allowances, newest first
	const years = $derived(
		[
			...new Set([
				...e.years.map((y) => y.year),
				...Object.entries(al.byYear)
					.filter(([, total]) => total > 0)
					.map(([y]) => Number(y))
			])
		].sort((a, b) => b - a)
	);
	const yearOf = $derived(new Map(e.years.map((y) => [y.year, y])));
	const cf = $derived(data.colleagueFilter);
	const tf = $derived(data.teamFilter);
	// chart switches keep the colleague and team filters
	const cfParam = $derived(
		(cf.season !== null ? `&ks=${cf.season}` : '') +
			(cf.area !== null ? `&ko=${cf.area}` : '') +
			(tf.season !== null ? `&ts=${tf.season}` : '') +
			(tf.area !== null ? `&to=${tf.area}` : '')
	);

	/** Category next to the competition name, unless the name already says it. */
	const withCategory = (name: string | null, category: string | null) => {
		const n = name ?? 'neznámá soutěž';
		return category && !n.toLowerCase().includes(category.toLowerCase()) ? category : null;
	};

	const submit = (event: Event) => (event.currentTarget as HTMLSelectElement).form?.requestSubmit();

	// colleagues: the first 10, all on request; each opens the games together
	let allColleagues = $state(false);
	const colleagues = $derived(allColleagues ? data.colleagues : data.colleagues.slice(0, 10));
	const colleagueHref = (id: number) =>
		resolve(
			`/games?kolega=${id}${cf.season !== null ? `&ks=${cf.season}` : ''}${cf.area !== null ? `&ko=${cf.area}` : ''}`
		);

	// teams: searchable without diacritics, the first 10 until searched or expanded
	let teamQuery = $state('');
	let allTeams = $state(false);
	const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
	const matchingTeams = $derived(
		teamQuery.trim()
			? data.teams.filter((t) =>
					fold(`${t.name} ${t.category ?? ''}`).includes(fold(teamQuery.trim()))
				)
			: data.teams
	);
	const teams = $derived(allTeams || teamQuery.trim() ? matchingTeams : matchingTeams.slice(0, 10));
	const teamHref = (t: { key: string; name: string; category: string | null }) =>
		resolve(
			`/games?tym=${encodeURIComponent(t.key)}&nazev=${encodeURIComponent(
				t.category ? `${t.name} · ${t.category}` : t.name
			)}${tf.season !== null ? `&ks=${tf.season}` : ''}${tf.area !== null ? `&ko=${tf.area}` : ''}`
		);
	const seasonsOf = (first: number | null, last: number | null) =>
		first === null
			? ''
			: first === last
				? seasonName(first)
				: `${seasonName(first)} – ${seasonName(last)}`;

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
							href={resolve(`/dashboard?g=${data.granularity}${m.param}${cfParam}`)}
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
							href={resolve(`/dashboard?g=${v.key}${metricParam}${cfParam}`)}
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
				Odměna za utkání podle sazebníků a <a class="hover:underline" href={resolve('/own-games')}
					>vlastních zápasů</a
				>, bez cestovného, stravného a příplatků za všední den.
			</p>
		</div>
		<div class="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
			<div>
				<p class="text-xs text-muted">Vyděláno celkem</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums">{formatKc(e.earned)}</p>
				<p class="text-xs text-muted">{formatNumber(e.paidGames)} odřízených zápasů</p>
				{#if e.own.games > 0}
					<p class="text-xs text-muted">
						z toho <a class="hover:underline" href={resolve('/own-games')}
							>vlastní {formatKc(e.own.earned)} ({formatNumber(e.own.games)})</a
						>
					</p>
				{/if}
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
		<div
			class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm"
		>
			<p class="text-ink-2">
				Náhrady (cestovné, stravné, všední den):
				<span class="font-semibold text-ink tabular-nums">{formatKc(al.all.total)}</span>
				celkem,
				<span class="font-medium text-ink tabular-nums">{formatKc(al.currentSeason.total)}</span>
				v sezóně {seasonName(data.currentSeasonYear)}
				{#if al.all.days > al.all.filled}
					· {al.all.days - al.all.filled} dnů nevyplněno
				{/if}
			</p>
			<a
				href={resolve('/trips')}
				class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
				>Cesty a náhrady</a
			>
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
							<th class="px-4 py-2 text-right font-medium">Náhrady</th>
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
								<td class="px-4 py-2 text-right whitespace-nowrap text-ink-2"
									>{al.bySeason[row.seasonYear] ? formatKc(al.bySeason[row.seasonYear]) : '—'}</td
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

		{#if years.length > 0}
			<details class="border-t border-line px-4 py-3 text-sm">
				<summary class="cursor-pointer text-xs text-muted hover:text-ink">
					Podle kalendářních let (pro daňové přiznání)
				</summary>
				<div class="mt-2 overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="text-xs text-muted">
							<tr>
								<th class="py-2 pr-4 font-medium">Rok</th>
								<th class="px-4 py-2 text-right font-medium">Zápasů</th>
								<th class="px-4 py-2 text-right font-medium">Odměny</th>
								<th class="hidden px-4 py-2 text-right font-medium sm:table-cell">z toho odhad</th>
								<th class="px-4 py-2 text-right font-medium">Náhrady</th>
								<th class="py-2 pl-4 text-right font-medium">Export</th>
							</tr>
						</thead>
						<tbody class="tabular-nums">
							{#each years as year (year)}
								{@const y = yearOf.get(year)}
								<tr class="border-t border-line">
									<td class="py-2 pr-4">{year}</td>
									<td class="px-4 py-2 text-right">{formatNumber(y?.paidGames ?? 0)}</td>
									<td class="px-4 py-2 text-right font-medium whitespace-nowrap"
										>{y?.earned ? formatKc(y.earned) : '—'}</td
									>
									<td class="hidden px-4 py-2 text-right whitespace-nowrap text-ink-2 sm:table-cell"
										>{y?.estimated ? formatKc(y.estimated) : '—'}</td
									>
									<td class="px-4 py-2 text-right whitespace-nowrap text-ink-2"
										>{al.byYear[year] ? formatKc(al.byYear[year]) : '—'}</td
									>
									<td class="py-2 pl-4 text-right whitespace-nowrap">
										<a
											class="text-accent hover:underline"
											href={resolve('/dashboard/export/[year]', { year: String(year) })}
											download>CSV</a
										>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="mt-2 text-xs text-ink-2">
					Odřízené zápasy podle data zápasu, ne podle sezóny. Částky jsou spočítané ze sazebníků,
					delegací a tvých cest, ne z výplat: před přiznáním je porovnej s tím, co ti skutečně
					přišlo. CSV má po řádcích odměny za zápasy i náhrady za jednotlivé dny.
				</p>
			</details>
		{/if}

		{#if e.unrated.length > 0}
			<details class="border-t border-line px-4 py-3 text-sm">
				<summary class="cursor-pointer text-xs text-muted hover:text-ink">
					Soutěže bez sazby ({formatNumber(e.unratedGames)} zápasů)
				</summary>
				<ul class="mt-2 divide-y divide-line">
					{#each e.unrated as u (u.key)}
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
								<td class="px-4 py-2">
									{c.name ?? 'neznámá soutěž'}
									{#if withCategory(c.name, c.category)}
										<span class="block text-xs text-ink-2">{withCategory(c.name, c.category)}</span>
									{/if}
								</td>
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
			<div class="border-b border-line px-4 py-3">
				<h2 class="text-sm font-semibold">Nejčastější kolegové</h2>
				<form method="GET" class="mt-2 grid gap-2" data-sveltekit-noscroll data-sveltekit-keepfocus>
					<input type="hidden" name="g" value={data.granularity} />
					{#if data.metric === 'earnings'}<input type="hidden" name="m" value="kc" />{/if}
					{#if tf.season !== null}<input type="hidden" name="ts" value={tf.season} />{/if}
					{#if tf.area !== null}<input type="hidden" name="to" value={tf.area} />{/if}
					<label class="grid gap-1 text-xs text-muted">
						Sezóna
						<select
							name="ks"
							class="rounded-md border-line bg-surface py-1 text-sm text-ink"
							onchange={submit}
						>
							<option value="" selected={cf.season === null}>Celá historie</option>
							{#each cf.seasons as y (y)}
								<option value={y} selected={cf.season === y}>{seasonName(y)}</option>
							{/each}
						</select>
					</label>
					<label class="grid gap-1 text-xs text-muted">
						Oblast
						<select
							name="ko"
							class="rounded-md border-line bg-surface py-1 text-sm text-ink"
							onchange={submit}
						>
							<option value="" selected={cf.area === null}>Všechny oblasti</option>
							{#each cf.areas as a (a.id)}
								<option value={a.id} selected={cf.area === a.id}>{a.name}</option>
							{/each}
						</select>
					</label>
					<noscript
						><button class="rounded-md border border-line px-3 py-1 text-sm">Filtrovat</button
						></noscript
					>
				</form>
			</div>
			{#if data.colleagues.length === 0}
				<p class="px-4 py-6 text-sm text-muted">Zatím nikdo.</p>
			{:else}
				<ul class="divide-y divide-line text-sm">
					{#each colleagues as c (c.officialId)}
						<li>
							<a
								href={colleagueHref(c.officialId)}
								class="flex items-center justify-between px-4 py-2 hover:bg-page"
							>
								<span>{c.firstName} {c.lastName}</span>
								<span class="text-ink-2 tabular-nums">{c.games}</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if data.colleagues.length > 10}
					<button
						type="button"
						class="w-full border-t border-line px-4 py-2 text-left text-xs text-ink-2 hover:text-ink"
						onclick={() => (allColleagues = !allColleagues)}
						>{allColleagues
							? 'Zobrazit jen 10'
							: `Zobrazit všechny (${data.colleagues.length})`}</button
					>
				{/if}
			{/if}
		</section>
	</div>

	<section class="rounded-lg border border-line bg-surface">
		<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
			<h2 class="text-sm font-semibold">Týmy, které jsem pískal</h2>
			<label class="w-full sm:w-72">
				<span class="sr-only">Hledat tým</span>
				<input
					type="search"
					bind:value={teamQuery}
					placeholder="Hledat tým nebo kategorii…"
					class="w-full rounded-md border-line bg-surface py-1 text-sm text-ink placeholder:text-muted"
				/>
			</label>
			<form
				method="GET"
				class="grid w-full gap-2 sm:grid-cols-2"
				data-sveltekit-noscroll
				data-sveltekit-keepfocus
			>
				<input type="hidden" name="g" value={data.granularity} />
				{#if data.metric === 'earnings'}<input type="hidden" name="m" value="kc" />{/if}
				{#if cf.season !== null}<input type="hidden" name="ks" value={cf.season} />{/if}
				{#if cf.area !== null}<input type="hidden" name="ko" value={cf.area} />{/if}
				<label class="grid gap-1 text-xs text-muted">
					Sezóna
					<select
						name="ts"
						class="rounded-md border-line bg-surface py-1 text-sm text-ink"
						onchange={submit}
					>
						<option value="" selected={tf.season === null}>Celá historie</option>
						{#each tf.seasons as y (y)}
							<option value={y} selected={tf.season === y}>{seasonName(y)}</option>
						{/each}
					</select>
				</label>
				<label class="grid gap-1 text-xs text-muted">
					Oblast
					<select
						name="to"
						class="rounded-md border-line bg-surface py-1 text-sm text-ink"
						onchange={submit}
					>
						<option value="" selected={tf.area === null}>Všechny oblasti</option>
						{#each tf.areas as a (a.id)}
							<option value={a.id} selected={tf.area === a.id}>{a.name}</option>
						{/each}
					</select>
				</label>
				<noscript
					><button class="rounded-md border border-line px-3 py-1 text-sm">Filtrovat</button
					></noscript
				>
			</form>
		</div>
		{#if data.teams.length === 0}
			<p class="px-4 py-6 text-sm text-muted">
				{tf.season !== null || tf.area !== null
					? 'Ve vybraném filtru žádné zápasy.'
					: 'Zatím žádné zápasy.'}
			</p>
		{:else if teams.length === 0}
			<p class="px-4 py-6 text-sm text-muted">Žádný tým neodpovídá „{teamQuery}“.</p>
		{:else}
			<table class="w-full text-left text-sm">
				<thead class="text-xs text-muted">
					<tr>
						<th class="px-4 py-2 font-medium">Tým</th>
						<th class="hidden px-4 py-2 font-medium sm:table-cell">Sezóny</th>
						<th class="hidden px-4 py-2 text-right font-medium sm:table-cell">Doma / venku</th>
						<th class="px-4 py-2 text-right font-medium">Zápasů</th>
					</tr>
				</thead>
				<tbody class="tabular-nums">
					{#each teams as t (t.key)}
						<tr class="border-t border-line">
							<td class="px-4 py-2">
								<a href={teamHref(t)} class="hover:underline">{t.name}</a>
								{#if t.category}<span class="block text-xs text-ink-2">{t.category}</span>{/if}
							</td>
							<td class="hidden px-4 py-2 text-ink-2 sm:table-cell"
								>{seasonsOf(t.firstSeason, t.lastSeason)}</td
							>
							<td class="hidden px-4 py-2 text-right text-ink-2 sm:table-cell"
								>{t.home} / {t.away}</td
							>
							<td class="px-4 py-2 text-right">{t.games}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if !teamQuery.trim() && data.teams.length > 10}
				<button
					type="button"
					class="w-full border-t border-line px-4 py-2 text-left text-xs text-ink-2 hover:text-ink"
					onclick={() => (allTeams = !allTeams)}
					>{allTeams ? 'Zobrazit jen 10' : `Zobrazit všechny (${data.teams.length})`}</button
				>
			{/if}
		{/if}
	</section>
</div>
