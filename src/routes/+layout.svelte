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
		<div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
			<a href={resolve('/')} class="text-base font-semibold tracking-tight text-ink">Rozhodčí ČBF</a
			>
			{#if data.user}
				<div class="flex items-center gap-3 text-sm">
					<span class="text-ink-2">{data.user.firstName} {data.user.lastName}</span>
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
