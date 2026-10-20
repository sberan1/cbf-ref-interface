<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate, formatKc, formatNumber } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const roles = [
		{ key: 'referee', label: 'Rozhodčí' },
		{ key: 'commissioner', label: 'Komisař' },
		{ key: 'table', label: 'Stolek' },
		{ key: 'other', label: 'Jiné' }
	] as const;
	const roleLabel = (key: string) => roles.find((r) => r.key === key)?.label ?? key;
	const gamesLabel = (n: number) =>
		`${formatNumber(n)} ${n === 1 ? 'zápas' : n >= 2 && n <= 4 ? 'zápasy' : 'zápasů'}`;

	type Draft = {
		id: number | null;
		date: string;
		title: string;
		role: string;
		games: string;
		fee: string;
		place: string;
		note: string;
	};
	const empty = (): Draft => ({
		id: null,
		date: data.today,
		title: '',
		role: 'referee',
		games: '1',
		fee: '',
		place: '',
		note: ''
	});
	let draft = $state<Draft>(empty());

	function edit(g: (typeof data.games)[number]) {
		draft = {
			id: g.id,
			date: g.date,
			title: g.title,
			role: g.role,
			games: String(g.games),
			fee: g.fee === null ? '' : String(g.fee),
			place: g.place ?? '',
			note: g.note ?? ''
		};
		document.getElementById('own-date')?.focus();
	}

	// totals per calendar year of the entries listed
	const years = $derived(
		[...new Set(data.games.map((g) => g.date.slice(0, 4)))].map((y) => {
			const games = data.games.filter((g) => g.date.startsWith(y) && g.date <= data.today);
			return {
				year: y,
				games: games.reduce((n, g) => n + g.games, 0),
				fee: games.reduce((n, g) => n + (g.fee ?? 0), 0)
			};
		})
	);

	const input = 'rounded-md border-line bg-surface text-sm text-ink placeholder:text-muted';
</script>

<svelte:head>
	<title>Vlastní zápasy – Rozhodčí ČBF</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Vlastní zápasy</h1>
		<p class="mt-1 text-sm text-ink-2">
			Přáteláky, turnaje a další akce mimo systém ČBF. Odměny se připočítají k odměnám na přehledu,
			do součtů za sezónu i kalendářní rok a do CSV pro daňové přiznání.
		</p>
	</div>

	<section class="rounded-lg border border-line bg-surface p-4">
		<h2 class="text-sm font-semibold">{draft.id === null ? 'Přidat zápas' : 'Upravit zápas'}</h2>
		<form
			method="POST"
			action="?/save"
			use:enhance={() =>
				async ({ result, update }) => {
					if (result.type === 'success') draft = empty();
					await update({ reset: false });
				}}
			class="mt-3 grid gap-3 sm:grid-cols-2"
		>
			{#if draft.id !== null}<input type="hidden" name="id" value={draft.id} />{/if}
			<label class="grid gap-1 text-xs text-muted">
				Datum
				<input
					id="own-date"
					name="date"
					type="date"
					required
					bind:value={draft.date}
					class={input}
				/>
			</label>
			<label class="grid gap-1 text-xs text-muted">
				Role
				<select name="role" bind:value={draft.role} class={input}>
					{#each roles as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
				</select>
			</label>
			<label class="grid gap-1 text-xs text-muted sm:col-span-2">
				Co to bylo
				<input
					name="title"
					required
					maxlength="200"
					bind:value={draft.title}
					placeholder="např. přátelák Sokol Michle – Slavia, turnaj U13 Kladno"
					class={input}
				/>
			</label>
			<label class="grid gap-1 text-xs text-muted">
				Počet zápasů
				<input
					name="games"
					type="number"
					min="1"
					max="50"
					required
					bind:value={draft.games}
					class={input}
				/>
			</label>
			<label class="grid gap-1 text-xs text-muted">
				Odměna celkem (Kč)
				<input
					name="fee"
					type="number"
					min="0"
					step="1"
					bind:value={draft.fee}
					placeholder="prázdné = zatím nevím / zdarma"
					class={input}
				/>
			</label>
			<label class="grid gap-1 text-xs text-muted">
				Místo
				<input name="place" maxlength="200" bind:value={draft.place} class={input} />
			</label>
			<label class="grid gap-1 text-xs text-muted">
				Poznámka
				<input name="note" maxlength="500" bind:value={draft.note} class={input} />
			</label>
			<div class="flex items-center gap-3 sm:col-span-2">
				<button
					class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
					>{draft.id === null ? 'Přidat' : 'Uložit změny'}</button
				>
				{#if draft.id !== null}
					<button
						type="button"
						class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent"
						onclick={() => (draft = empty())}>Zrušit úpravy</button
					>
				{/if}
				{#if form?.error}<span class="text-xs text-danger" role="alert">{form.error}</span>{/if}
				{#if form?.saved}<span class="text-xs text-ink-2">Uloženo.</span>{/if}
			</div>
		</form>
	</section>

	{#if years.length > 0}
		<section class="rounded-lg border border-line bg-surface">
			<h2 class="border-b border-line px-4 py-3 text-sm font-semibold">Zápasy</h2>
			<p class="border-b border-line px-4 py-2 text-xs text-ink-2">
				{#each years as y, i (y.year)}{i > 0 ? ' · ' : ''}{y.year}: {gamesLabel(y.games)},
					{formatKc(y.fee)}{/each}
			</p>
			<ul class="divide-y divide-line text-sm">
				{#each data.games as g (g.id)}
					<li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2">
						<div class="min-w-0">
							<p>
								<span class="text-ink-2 tabular-nums">{formatDate(g.date)}</span>
								<span class="font-medium">{g.title}</span>
							</p>
							<p class="text-xs text-muted">
								{roleLabel(g.role)}{g.games > 1 ? ` · ${gamesLabel(g.games)}` : ''}{g.place
									? ` · ${g.place}`
									: ''}{g.note ? ` · ${g.note}` : ''}{g.date > data.today ? ' · nadcházející' : ''}
							</p>
						</div>
						<div class="flex items-center gap-3">
							<span class="tabular-nums">{g.fee === null ? '—' : formatKc(g.fee)}</span>
							<button
								type="button"
								class="text-xs text-ink-2 hover:text-ink"
								onclick={() => edit(g)}>Upravit</button
							>
							<form
								method="POST"
								action="?/delete"
								use:enhance={({ cancel }) => {
									if (!confirm(`Smazat „${g.title}“?`)) cancel();
								}}
							>
								<input type="hidden" name="id" value={g.id} />
								<button class="text-xs text-danger hover:underline">Smazat</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="text-sm text-muted">Zatím žádné vlastní zápasy.</p>
	{/if}
</div>
