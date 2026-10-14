<script lang="ts">
	import { enhance } from '$app/forms';
	import AddressInput from '#lib/components/AddressInput.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// the form starts from the saved address; later edits are local until saved
	const savedHome = () => data.home.address ?? '';
	let homeAddress = $state(savedHome());
	let homePoint = $state<{ lat: number; lon: number; municipality: string | null } | null>(null);
	let placeLabel = $state('');
	let placeAddress = $state('');
	let placePoint = $state<{ lat: number; lon: number; municipality: string | null } | null>(null);
</script>

<svelte:head>
	<title>Profil – Rozhodčí ČBF</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Profil</h1>
		<p class="mt-1 text-sm text-ink-2">Přihlášen jako {data.email}.</p>
	</div>

	{#if !data.mapsLive}
		<p class="rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-2">
			Mapy.com nejsou na serveru nastavené (<code>MAPY_API_KEY</code>): adresy z napovídání
			nefungují a vzdálenosti se počítají jen odhadem vzdušnou čarou.
		</p>
	{/if}

	<section class="rounded-lg border border-line bg-surface p-4">
		<h2 class="text-sm font-semibold">Bydliště</h2>
		<p class="mt-1 text-xs text-muted">
			Odsud začínají a končí cesty na zápasy. Obec se porovnává s místem zápasu kvůli náhradě za
			všední den (rozhodčí z místa konání ji nedostává).
		</p>
		<form
			method="POST"
			action="?/home"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mt-3 space-y-2"
		>
			<label for="home" class="sr-only">Adresa bydliště</label>
			<AddressInput id="home" bind:address={homeAddress} bind:point={homePoint} required />
			<input type="hidden" name="address" value={homeAddress} />
			<input type="hidden" name="lat" value={homePoint?.lat ?? ''} />
			<input type="hidden" name="lon" value={homePoint?.lon ?? ''} />
			<input type="hidden" name="municipality" value={homePoint?.municipality ?? ''} />
			<div class="flex items-center gap-3">
				<button
					class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
					>Uložit</button
				>
				{#if form?.homeSaved}<span class="text-xs text-ink-2"
						>Uloženo. Automatické cesty se přepočítají v Cestách.</span
					>{/if}
				{#if form?.homeError}<span class="text-xs text-danger" role="alert">{form.homeError}</span
					>{/if}
			</div>
			{#if data.home.address}
				<p class="text-xs text-muted">
					Teď: {data.home.address}{data.home.municipality
						? ` (obec ${data.home.municipality})`
						: ''}
				</p>
			{/if}
		</form>
	</section>

	<section class="rounded-lg border border-line bg-surface p-4">
		<h2 class="text-sm font-semibold">Uložená místa</h2>
		<p class="mt-1 text-xs text-muted">
			Kde nabíráš a vysazuješ kolegy. Průvodce cestou je nabízí a ukládá sem i nová místa.
		</p>
		{#if data.places.length > 0}
			<ul class="mt-3 divide-y divide-line text-sm">
				{#each data.places as p (p.id)}
					<li class="flex items-center justify-between gap-3 py-2">
						<span>
							<span class="font-medium">{p.label}</span>
							<span class="block text-xs text-muted">{p.address}</span>
						</span>
						<form method="POST" action="?/deletePlace" use:enhance>
							<input type="hidden" name="id" value={p.id} />
							<button class="text-xs text-ink-2 hover:text-danger">Smazat</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
		<form
			method="POST"
			action="?/addPlace"
			use:enhance
			class="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr_auto]"
		>
			<label for="place-label" class="sr-only">Název</label>
			<input
				id="place-label"
				name="label"
				bind:value={placeLabel}
				placeholder="např. Novák – doma"
				class="rounded-md border-line bg-surface text-sm text-ink placeholder:text-muted"
			/>
			<label for="place-address" class="sr-only">Adresa</label>
			<AddressInput id="place-address" bind:address={placeAddress} bind:point={placePoint} />
			<input type="hidden" name="address" value={placeAddress} />
			<input type="hidden" name="lat" value={placePoint?.lat ?? ''} />
			<input type="hidden" name="lon" value={placePoint?.lon ?? ''} />
			<input type="hidden" name="municipality" value={placePoint?.municipality ?? ''} />
			<button class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent"
				>Přidat</button
			>
		</form>
		{#if form?.placeError}<p class="mt-2 text-xs text-danger" role="alert">
				{form.placeError}
			</p>{/if}
	</section>
</div>
