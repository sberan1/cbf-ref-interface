<script lang="ts">
	/**
	 * Address field with Mapy.com suggestions (via /api/geo/suggest). Picking a suggestion also
	 * sets `point`; typing clears it and the server geocodes the text on save.
	 */
	interface Suggestion {
		label: string;
		lat: number;
		lon: number;
		municipality: string | null;
	}

	interface Props {
		id: string;
		address: string;
		point: { lat: number; lon: number; municipality: string | null } | null;
		placeholder?: string;
		required?: boolean;
	}

	let {
		id,
		address = $bindable(),
		point = $bindable(),
		placeholder = 'ulice a číslo, obec',
		required = false
	}: Props = $props();

	let suggestions = $state<Suggestion[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let requestId = 0;

	function onInput() {
		point = null;
		clearTimeout(timer);
		const q = address.trim();
		if (q.length < 3) {
			suggestions = [];
			open = false;
			return;
		}
		timer = setTimeout(async () => {
			const mine = ++requestId;
			try {
				const res = await fetch(`/api/geo/suggest?q=${encodeURIComponent(q)}`);
				const list = res.ok ? ((await res.json()) as Suggestion[]) : [];
				if (mine !== requestId) return;
				suggestions = list;
				open = list.length > 0;
				active = -1;
			} catch {
				suggestions = [];
			}
		}, 250);
	}

	function pick(s: Suggestion) {
		address = s.label;
		point = { lat: s.lat, lon: s.lon, municipality: s.municipality };
		open = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'ArrowDown') {
			active = (active + 1) % suggestions.length;
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			active = (active - 1 + suggestions.length) % suggestions.length;
			e.preventDefault();
		} else if (e.key === 'Enter' && active >= 0) {
			pick(suggestions[active]);
			e.preventDefault();
		} else if (e.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="relative">
	<input
		{id}
		type="text"
		bind:value={address}
		oninput={onInput}
		onkeydown={onKeydown}
		onblur={() => setTimeout(() => (open = false), 150)}
		{placeholder}
		{required}
		autocomplete="off"
		role="combobox"
		aria-expanded={open}
		aria-controls={`${id}-list`}
		aria-autocomplete="list"
		class="w-full rounded-md border-line bg-surface text-sm text-ink placeholder:text-muted focus:border-accent focus:ring-accent"
	/>
	{#if open}
		<ul
			id={`${id}-list`}
			role="listbox"
			class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface py-1 text-sm shadow-md"
		>
			{#each suggestions as s, i (`${s.lat},${s.lon},${s.label}`)}
				<li role="option" aria-selected={i === active}>
					<button
						type="button"
						class={['block w-full px-3 py-1.5 text-left hover:bg-page', i === active && 'bg-page']}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(s)}
					>
						{s.label}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if point}
		<p class="mt-0.5 text-xs text-muted">
			✓ poloha nalezena{point.municipality ? ` (${point.municipality})` : ''}
		</p>
	{/if}
</div>
