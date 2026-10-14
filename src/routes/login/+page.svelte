<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Přihlášení – Rozhodčí ČBF</title>
</svelte:head>

<div class="mx-auto max-w-md">
	<h1 class="text-2xl font-semibold tracking-tight">Přihlášení rozhodčího</h1>
	<p class="mt-2 text-sm text-ink-2">
		Přihlas se svým Google účtem. Při prvním přihlášení si vybereš svůj záznam rozhodčího z ČBF a
		správce tvůj účet schválí. Potom uvidíš své zápasy, odměny a náhrady.
	</p>

	{#if data.error}
		<p class="mt-4 text-sm text-danger" role="alert">{data.error}</p>
	{/if}

	{#if data.configured}
		<a
			href={resolve('/login/google')}
			data-sveltekit-reload
			class="mt-6 inline-flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink shadow-sm hover:border-accent"
		>
			<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
				<path
					fill="#FFC107"
					d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
				/>
				<path
					fill="#FF3D00"
					d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
				/>
				<path
					fill="#4CAF50"
					d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
				/>
				<path
					fill="#1976D2"
					d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
				/>
			</svg>
			Přihlásit se přes Google
		</a>
	{:else}
		<p class="mt-6 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-2">
			Přihlášení přes Google zatím není na serveru nastavené (chybí <code>GOOGLE_CLIENT_ID</code> a
			<code>GOOGLE_CLIENT_SECRET</code>).
		</p>
	{/if}
</div>
