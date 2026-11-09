<script lang="ts">
	import { enhance } from '$app/forms';
	import AddressInput from '#lib/components/AddressInput.svelte';
	import { formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Venue = PageProps['data']['venues'][number];

	// hall being corrected, with the address typed for it
	let fixing = $state<number | null>(null);
	let address = $state('');
	let point = $state<{ lat: number; lon: number; municipality: string | null } | null>(null);
	let busy = $state(false);

	function startFix(v: Venue) {
		fixing = v.id;
		address = v.fix?.address ?? v.address;
		point = null;
	}

	const filters = [
		{ key: 'all', label: 'Všechny' },
		{ key: 'nogps', label: 'Bez GPS z ČBF' },
		{ key: 'fixed', label: 'Opravené' }
	] as const;

	const dateTime = new Intl.DateTimeFormat('cs-CZ', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'Europe/Prague'
	});

	const source = (v: Venue) =>
		v.fix ? 'opravená ručně' : v.lat !== null ? 'GPS z ČBF' : 'ČBF ji nemá, hledá se podle adresy';

	const enhanced = () => {
		busy = true;
		return async ({
			result,
			update
		}: {
			result: { type: string };
			update: (opts?: { reset?: boolean }) => Promise<void>;
		}) => {
			await update({ reset: false });
			busy = false;
			if (result.type === 'success') fixing = null;
		};
	};
</script>

<svelte:head>
	<title>Haly – Rozhodčí ČBF</title>
</svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Haly</h1>
		<p class="mt-1 text-sm text-ink-2">
			Když někdo nahlásí špatně umístěnou halu, najdi ji a oprav adresou. Oprava platí pro všechny a
			jejich cesty přes tu halu se hned přepočítají.
		</p>
	</div>

	{#if !data.mapsLive}
		<p class="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-2">
			Mapy.com nejsou na serveru nastavené (<code>MAPY_API_KEY</code>): adresy nejde vyhledat.
		</p>
	{/if}

	<form method="GET" class="flex flex-wrap items-end gap-2" data-sveltekit-keepfocus>
		<label class="min-w-0 flex-1 text-xs text-muted">
			Hledat halu
			<input
				name="q"
				value={data.q}
				placeholder="název, ulice nebo obec"
				class="mt-0.5 block w-full rounded-md border-line bg-surface text-sm text-ink placeholder:text-muted"
			/>
		</label>
		<label class="text-xs text-muted">
			Zobrazit
			<select
				name="f"
				class="mt-0.5 block rounded-md border-line bg-surface text-sm text-ink"
				value={data.filter}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			>
				{#each filters as f (f.key)}<option value={f.key}>{f.label}</option>{/each}
			</select>
		</label>
		<button class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent"
			>Hledat</button
		>
	</form>

	{#if form && 'done' in form}
		<p class="rounded-md border border-line bg-surface px-4 py-3 text-sm" role="status">
			{form.done === 'reverted' ? 'Vrácena poloha z ČBF' : 'Poloha uložena'}: {form.venueName}.
			Přepočítané cesty: {form.rerouted}.{form.failed
				? ` U ${form.failed} se trasu nepodařilo spočítat, zůstala původní.`
				: ''}
		</p>
	{/if}

	{#if data.venues.length === 0}
		<p class="text-sm text-muted">Nic nenalezeno.</p>
	{:else}
		<ul class="space-y-3">
			{#each data.venues as v (v.id)}
				<li class="rounded-lg border border-line bg-surface p-4">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<p class="text-sm">
							<span class="font-medium">{v.name ?? 'Hala bez názvu'}</span>
							{#if v.address}<span class="block text-xs text-muted">{v.address}</span>{/if}
						</p>
						<p class="text-xs text-muted">
							{v.games}
							{v.games === 1
								? 'zápas'
								: v.games >= 2 && v.games <= 4
									? 'zápasy'
									: 'zápasů'}{v.lastGame ? `, naposledy ${formatDate(v.lastGame)}` : ''}
						</p>
					</div>
					<p class="mt-1 text-xs text-ink-2">
						Poloha: {source(v)}{v.fix ? ` (${v.fix.address})` : ''}
						{#if v.mapUrl}
							·
							<!-- eslint-disable svelte/no-navigation-without-resolve -- external mapy.com link -->
							<a
								href={v.mapUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="text-accent hover:underline">ukázat na mapě</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
					</p>
					{#if v.fix}
						<p class="mt-0.5 text-xs text-muted">
							Opravil {v.fix.by ?? 'smazaný účet'}, {dateTime.format(new Date(v.fix.at))}
						</p>
					{/if}

					{#if fixing === v.id}
						<form method="POST" action="?/fix" use:enhance={enhanced} class="mt-3 space-y-2">
							<input type="hidden" name="venueId" value={v.id} />
							<label for={`fix-${v.id}`} class="text-xs text-muted">Správná adresa haly</label>
							<AddressInput id={`fix-${v.id}`} bind:address bind:point required />
							<input type="hidden" name="address" value={address} />
							<input type="hidden" name="lat" value={point?.lat ?? ''} />
							<input type="hidden" name="lon" value={point?.lon ?? ''} />
							<div class="flex flex-wrap gap-2">
								<button
									disabled={busy}
									class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
									>{busy ? 'Přepočítávám cesty…' : 'Uložit polohu'}</button
								>
								<button
									type="button"
									class="rounded-md border border-line px-3 py-1.5 text-sm"
									onclick={() => (fixing = null)}>Zrušit</button
								>
							</div>
						</form>
					{:else}
						<div class="mt-3 flex flex-wrap gap-2">
							<button
								type="button"
								class="rounded-md border border-line px-3 py-1 text-xs hover:border-accent"
								onclick={() => startFix(v)}>Opravit polohu</button
							>
							{#if v.fix}
								<form method="POST" action="?/unfix" use:enhance={enhanced}>
									<input type="hidden" name="venueId" value={v.id} />
									<button
										disabled={busy}
										class="rounded-md border border-line px-3 py-1 text-xs hover:border-danger disabled:opacity-50"
										>Vrátit polohu z ČBF</button
									>
								</form>
							{/if}
						</div>
					{/if}

					{#if form && 'error' in form && form.venueId === v.id}
						<p class="mt-2 text-xs text-danger" role="alert">{form.error}</p>
					{/if}
				</li>
			{/each}
		</ul>
		{#if data.more}
			<p class="text-xs text-muted">Zobrazeno prvních 50 hal, upřesni hledání.</p>
		{/if}
	{/if}
</div>
