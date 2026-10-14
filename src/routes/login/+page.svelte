<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const formatDate = (iso: string | null) =>
		iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('cs-CZ') : '—';

	type Candidate = PageProps['data']['results'][number];

	/** "ID 58712 · kanonické ID 650 · 21 zápasů jako komisař · naposledy 25. 10. 2026" */
	function describe(r: Candidate): string {
		const roles =
			r.refereeGames && r.commissionerGames
				? ` (${r.refereeGames} rozhodčí, ${r.commissionerGames} komisař)`
				: r.commissionerGames
					? ' jako komisař'
					: '';
		return [
			`ID ${r.id}`,
			r.groupId && r.groupId !== r.id ? `kanonické ID ${r.groupId}` : null,
			`${r.games} ${r.games === 1 ? 'zápas' : r.games >= 2 && r.games <= 4 ? 'zápasy' : 'zápasů'}${roles}`,
			`naposledy ${formatDate(r.lastGameDate)}`
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<svelte:head>
	<title>Přihlášení – Rozhodčí ČBF</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="text-2xl font-semibold tracking-tight">Přihlášení rozhodčího</h1>
	<p class="mt-2 text-sm text-ink-2">
		Najděte se podle jména nebo ID z ČBF a vyberte svůj záznam. Účet se tím spáruje s daným
		rozhodčím.
	</p>

	<form method="GET" class="mt-6 flex gap-2" role="search">
		<label for="q" class="sr-only">Jméno nebo ID rozhodčího</label>
		<input
			id="q"
			name="q"
			type="search"
			value={data.q}
			minlength="2"
			placeholder="např. Novák nebo 53310"
			autocomplete="off"
			class="w-full rounded-md border-line bg-surface text-ink placeholder:text-muted focus:border-accent focus:ring-accent"
		/>
		<button
			type="submit"
			class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
		>
			Hledat
		</button>
	</form>

	{#if form?.error}
		<p class="mt-4 text-sm text-danger" role="alert">{form.error}</p>
	{/if}

	{#if data.q.trim().length >= 2}
		{#if data.results.length === 0}
			<p class="mt-6 text-sm text-ink-2">Nikdo takový v datech není. Zkuste jiný tvar jména.</p>
		{:else}
			<ul class="mt-6 divide-y divide-line rounded-lg border border-line bg-surface">
				{#each data.results as r (r.id)}
					<li class="flex items-center justify-between gap-4 px-4 py-3">
						<div class="min-w-0">
							<p class="font-medium">{r.firstName} {r.lastName}</p>
							<p class="text-xs text-muted">
								{describe(r)}
							</p>
						</div>
						<form method="POST">
							<input type="hidden" name="officialId" value={r.id} />
							<button
								type="submit"
								class="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
							>
								To jsem já
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	<p class="mt-8 text-xs text-muted">
		Přihlášení je zatím bez hesla a slouží jen pro interní použití.
	</p>
</div>
