<script lang="ts">
	import './layout.css';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen font-sans">
	<header class="border-b border-line bg-surface">
		<div
			class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
		>
			<a href={resolve('/')} class="text-base font-semibold tracking-tight text-ink">Rozhodčí ČBF</a
			>
			{#if data.user}
				<nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Hlavní">
					{#if data.user.approved}
						<a href={resolve('/dashboard')} class="rounded px-2 py-1 text-ink-2 hover:text-ink"
							>Přehled</a
						>
						<a href={resolve('/trips')} class="rounded px-2 py-1 text-ink-2 hover:text-ink"
							>Cesty a náhrady</a
						>
						<a href={resolve('/payouts')} class="rounded px-2 py-1 text-ink-2 hover:text-ink"
							>Vyúčtování</a
						>
						<a href={resolve('/own-games')} class="rounded px-2 py-1 text-ink-2 hover:text-ink"
							>Vlastní zápasy</a
						>
						<a href={resolve('/profile')} class="rounded px-2 py-1 text-ink-2 hover:text-ink"
							>Profil</a
						>
					{/if}
					{#if data.user.isAdmin}
						<a href={resolve('/admin')} class="rounded px-2 py-1 text-ink-2 hover:text-ink">Účty</a>
					{/if}
				</nav>
				<div class="flex items-center gap-3 text-sm">
					<span class="hidden text-ink-2 sm:inline">{data.user.displayName}</span>
					<form method="POST" action="/logout">
						<button
							type="submit"
							class="rounded-md border border-line px-3 py-1.5 text-ink-2 hover:bg-page hover:text-ink"
						>
							Odhlásit
						</button>
					</form>
				</div>
			{/if}
		</div>
	</header>
	<main class="mx-auto max-w-6xl px-4 py-6">
		{@render children()}
	</main>
</div>
