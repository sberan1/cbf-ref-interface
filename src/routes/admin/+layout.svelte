<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { children } = $props();

	const tabs = [
		{ href: resolve('/admin'), label: 'Účty' },
		{ href: resolve('/admin/venues'), label: 'Haly' }
	];
</script>

<nav class="mb-6 flex gap-1 border-b border-line text-sm" aria-label="Správa">
	{#each tabs as t (t.href)}
		<a
			href={t.href}
			aria-current={page.url.pathname === t.href ? 'page' : undefined}
			class={[
				'-mb-px border-b-2 px-3 py-2',
				page.url.pathname === t.href
					? 'border-accent font-medium text-ink'
					: 'border-transparent text-ink-2 hover:text-ink'
			]}>{t.label}</a
		>
	{/each}
</nav>
{@render children()}
