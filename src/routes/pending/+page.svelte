<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const who = $derived(
		data.requested
			? `${data.requested.firstName ?? ''} ${data.requested.lastName ?? ''} (ID ${data.requested.id})`
			: 'rozhodčího'
	);
</script>

<svelte:head>
	<title>Čeká na schválení – Rozhodčí ČBF</title>
</svelte:head>

<div class="mx-auto max-w-xl">
	{#if data.status === 'rejected'}
		<h1 class="text-2xl font-semibold tracking-tight">Žádost nebyla schválena</h1>
		<p class="mt-2 text-sm text-ink-2">
			Správce nespároval účet {data.account} se záznamem {who}. Pokud jde o omyl, vyber se znovu
			nebo kontaktuj správce.
		</p>
	{:else}
		<h1 class="text-2xl font-semibold tracking-tight">Čeká na schválení</h1>
		<p class="mt-2 text-sm text-ink-2">
			Účet {data.account} čeká, až ho správce spáruje se záznamem {who}. Jakmile to udělá, po
			obnovení stránky uvidíš svůj přehled.
		</p>
	{/if}
	<a
		href={resolve('/pair')}
		class="mt-6 inline-block rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
	>
		Vybrat jiný záznam
	</a>
</div>
