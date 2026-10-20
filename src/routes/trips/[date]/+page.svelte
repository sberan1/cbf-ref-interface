<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import AddressInput from '#lib/components/AddressInput.svelte';
	import { formatDate, formatDuration, formatTime, formatKc, formatNumber } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Stop = PageProps['data']['stops'][number];
	type Point = { lat: number; lon: number; municipality: string | null };
	interface EditStop extends Stop {
		key: number;
		point: Point | null;
		address: string;
	}

	let nextKey = 0;
	const toEdit = (s: Stop): EditStop => ({
		...s,
		key: nextKey++,
		address: s.address ?? '',
		point:
			s.lat != null && s.lon != null
				? { lat: s.lat, lon: s.lon, municipality: s.municipality ?? null }
				: null
	});

	let mode = $state<'car' | 'passenger' | 'public' | 'none'>('car');
	let stops = $state<EditStop[]>([]);
	let ticketCost = $state('');
	let extraCost = $state('');
	let note = $state('');
	let savePlaces = $state(true);
	let busy = $state(false);

	// reset the editor whenever the server data changes (first load, after saving)
	$effect.pre(() => {
		stops = data.stops.map(toEdit);
		mode = data.trip?.mode ?? 'car';
		ticketCost = data.trip?.ticketCost?.toString() ?? '';
		extraCost = data.trip?.extraCost?.toString() ?? '';
		note = data.trip?.note ?? '';
	});

	const modes = [
		{ key: 'car', label: 'Autem, řídil jsem', hint: 'cestovné 4,50 Kč/km, s kolegou 5 Kč/km' },
		{ key: 'passenger', label: 'Autem jako spolujezdec', hint: 'cestovné bere řidič, ty stravné' },
		{ key: 'public', label: 'Veřejnou dopravou', hint: 'jízdenky podle dokladů' },
		{ key: 'none', label: 'Bez cesty', hint: 'např. hala hned vedle' }
	] as const;

	const firstVenue = $derived(stops.findIndex((s) => s.kind === 'venue'));

	function add(kind: 'pickup' | 'dropoff') {
		const colleague = data.colleagues[0] ?? '';
		const place = data.places.find((p) => p.label === colleague);
		const stop = toEdit({
			kind,
			label: kind === 'pickup' ? 'Vyzvednutí' : 'Vysazení',
			colleague,
			address: place?.address ?? '',
			lat: place?.lat ?? null,
			lon: place?.lon ?? null,
			municipality: place?.municipality ?? null,
			gameIds: null
		});
		const at = kind === 'pickup' ? Math.max(1, firstVenue) : stops.length - 1;
		stops.splice(at, 0, stop);
	}

	function move(i: number, by: -1 | 1) {
		const j = i + by;
		if (j < 1 || j > stops.length - 2) return;
		[stops[i], stops[j]] = [stops[j], stops[i]];
	}

	function usePlace(s: EditStop, id: string) {
		const p = data.places.find((pl) => String(pl.id) === id);
		if (!p) return;
		s.address = p.address;
		s.point = { lat: p.lat, lon: p.lon, municipality: p.municipality };
		if (!s.colleague) s.colleague = p.label;
	}

	const serialized = $derived(
		JSON.stringify(
			stops.map((s) => ({
				kind: s.kind,
				label: s.label,
				address: s.address || null,
				lat: s.point?.lat ?? null,
				lon: s.point?.lon ?? null,
				municipality: s.point?.municipality ?? null,
				colleague: s.colleague || null,
				gameIds: s.gameIds ?? null
			}))
		)
	);

	const a = $derived(data.allowance);
	const legRows = $derived(
		(data.trip?.legs ?? []).map((leg, i) => ({
			...leg,
			from: data.stops[i]?.colleague
				? `${data.stops[i].label} (${data.stops[i].colleague})`
				: data.stops[i]?.label,
			to: data.stops[i + 1]?.colleague
				? `${data.stops[i + 1].label} (${data.stops[i + 1].colleague})`
				: data.stops[i + 1]?.label
		}))
	);
	const enhanced = () => {
		busy = true;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head>
	<title>Cesta {formatDate(data.date)} – Rozhodčí ČBF</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a href={resolve('/trips')} class="text-xs text-muted hover:text-ink">← Cesty a náhrady</a>
		<h1 class="mt-1 text-2xl font-semibold tracking-tight">
			{formatDate(data.date)}
			{#if data.holiday}<span class="text-base font-normal text-muted">· {data.holiday}</span>{/if}
		</h1>
		<ul class="mt-2 space-y-1 text-sm">
			{#each data.games as g (g.id)}
				<li>
					<span class="text-ink-2">{formatTime(g.startsAt) || 'čas neurčen'}</span>
					· {g.teams} · {g.competition ?? 'soutěž?'}
					<span class="block text-xs text-muted"
						>{g.venue || 'hala?'}{g.colleagues.length
							? ` · s: ${g.colleagues.join(', ')}`
							: ''}{g.role === 'commissioner' ? ' · komisař' : ''}</span
					>
				</li>
			{/each}
		</ul>
	</div>

	{#if !data.hasHome}
		<p class="rounded-md border border-line bg-surface px-4 py-3 text-sm">
			Nejdřív si v <a href={resolve('/profile')} class="text-accent underline">profilu</a> nastav bydliště.
		</p>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[1fr_22rem]">
		<form
			method="POST"
			action="?/save"
			use:enhance={enhanced}
			class="space-y-5 rounded-lg border border-line bg-surface p-4"
		>
			<fieldset>
				<legend class="text-sm font-semibold">1. Jak jsi jel?</legend>
				<div class="mt-2 grid gap-2 sm:grid-cols-2">
					{#each modes as m (m.key)}
						<label
							class={[
								'flex cursor-pointer gap-2 rounded-md border px-3 py-2 text-sm',
								mode === m.key ? 'border-accent' : 'border-line'
							]}
						>
							<input type="radio" name="mode" value={m.key} bind:group={mode} class="mt-0.5" />
							<span>{m.label}<span class="block text-xs text-muted">{m.hint}</span></span>
						</label>
					{/each}
				</div>
			</fieldset>

			{#if mode !== 'none'}
				<fieldset>
					<legend class="text-sm font-semibold">2. Trasa</legend>
					<p class="mt-1 text-xs text-muted">
						Haly bereme ze zápasů. Přidej, kde jsi kolegu nabral a kde vysadil; mezi nabráním a
						vysazením se počítá sazba s kolegou.
					</p>
					<ol class="mt-3 space-y-2">
						{#each stops as s, i (s.key)}
							<li class="rounded-md border border-line px-3 py-2">
								{#if s.kind === 'home' || s.kind === 'venue'}
									<p class="text-sm">
										<span class="font-medium">{s.kind === 'home' ? 'Domov' : s.label}</span>
										<span class="block text-xs text-muted">{s.address ?? ''}</span>
									</p>
								{:else}
									<div class="flex flex-wrap items-center justify-between gap-2">
										<p class="text-sm font-medium">
											{s.kind === 'pickup' ? '↑ Nabírám kolegu' : '↓ Vysazuji kolegu'}
										</p>
										<div class="flex gap-1 text-xs">
											<button
												type="button"
												class="rounded border border-line px-2 py-0.5"
												onclick={() => move(i, -1)}
												aria-label="Posunout výš">↑</button
											>
											<button
												type="button"
												class="rounded border border-line px-2 py-0.5"
												onclick={() => move(i, 1)}
												aria-label="Posunout níž">↓</button
											>
											<button
												type="button"
												class="rounded border border-line px-2 py-0.5 hover:text-danger"
												onclick={() => stops.splice(i, 1)}>Odebrat</button
											>
										</div>
									</div>
									<div class="mt-2 grid gap-2 sm:grid-cols-2">
										<label class="text-xs text-muted">
											Kolega
											<input
												bind:value={s.colleague}
												list="colleagues"
												class="mt-0.5 block w-full rounded-md border-line bg-surface text-sm text-ink"
											/>
										</label>
										{#if data.places.length}
											<label class="text-xs text-muted">
												Uložené místo
												<select
													class="mt-0.5 block w-full rounded-md border-line bg-surface text-sm text-ink"
													onchange={(e) => usePlace(s, e.currentTarget.value)}
												>
													<option value="">—</option>
													{#each data.places as p (p.id)}
														<option value={String(p.id)}>{p.label}</option>
													{/each}
												</select>
											</label>
										{/if}
									</div>
									<div class="mt-2">
										<label for={`addr-${s.key}`} class="text-xs text-muted">Adresa</label>
										<AddressInput
											id={`addr-${s.key}`}
											bind:address={s.address}
											bind:point={s.point}
										/>
									</div>
								{/if}
							</li>
						{/each}
					</ol>
					<datalist id="colleagues">
						{#each data.colleagues as c (c)}<option value={c}></option>{/each}
					</datalist>
					<div class="mt-3 flex flex-wrap gap-2">
						<button
							type="button"
							onclick={() => add('pickup')}
							class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent"
							>+ Nabírám kolegu</button
						>
						<button
							type="button"
							onclick={() => add('dropoff')}
							class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent"
							>+ Vysazuji kolegu</button
						>
					</div>
					<label class="mt-3 flex items-center gap-2 text-xs text-ink-2">
						<input type="checkbox" bind:checked={savePlaces} />
						Uložit adresy kolegů pro příště
					</label>
				</fieldset>
			{/if}

			<fieldset class="grid gap-3 sm:grid-cols-2">
				<legend class="text-sm font-semibold">3. Ostatní výdaje</legend>
				{#if mode === 'public'}
					<label class="text-xs text-muted">
						Jízdenky celkem (Kč)
						<input
							name="ticketCost"
							bind:value={ticketCost}
							inputmode="numeric"
							class="mt-0.5 block w-full rounded-md border-line bg-surface text-sm text-ink"
						/>
					</label>
				{/if}
				<label class="text-xs text-muted">
					Parkovné a jiné doklady (Kč)
					<input
						name="extraCost"
						bind:value={extraCost}
						inputmode="numeric"
						class="mt-0.5 block w-full rounded-md border-line bg-surface text-sm text-ink"
					/>
				</label>
				<label class="text-xs text-muted sm:col-span-2">
					Poznámka
					<input
						name="note"
						bind:value={note}
						maxlength="500"
						class="mt-0.5 block w-full rounded-md border-line bg-surface text-sm text-ink"
					/>
				</label>
			</fieldset>

			<input type="hidden" name="stops" value={serialized} />
			<input type="hidden" name="savePlaces" value={savePlaces ? 'on' : ''} />
			{#if form?.error}<p class="text-sm text-danger" role="alert">{form.error}</p>{/if}
			<div class="flex flex-wrap items-center gap-3">
				<button
					disabled={busy || (!data.hasHome && mode !== 'none')}
					class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
				>
					{busy ? 'Počítám trasu…' : 'Uložit a spočítat'}
				</button>
				{#if form?.saved}<span class="text-sm text-ink-2" role="status">Uloženo.</span>{/if}
			</div>
		</form>

		<aside class="space-y-4">
			<section class="rounded-lg border border-line bg-surface p-4">
				<h2 class="text-sm font-semibold">Náhrady za den</h2>
				{#if a && data.trip}
					<p class="mt-1 text-xs text-muted">
						{data.trip.status === 'auto'
							? 'Spočítáno automaticky (sám autem z domova), po uložení se potvrdí.'
							: 'Potvrzeno.'}
					</p>
					<dl class="mt-3 space-y-2 text-sm tabular-nums">
						{#if a.mode === 'car'}
							<div class="flex justify-between gap-3">
								<dt class="text-ink-2">
									Sám {formatNumber(a.km.alone)} km × {formatNumber(a.rates.alone)} Kč
								</dt>
								<dd>{formatKc(Math.round(a.km.alone * a.rates.alone))}</dd>
							</div>
							{#if a.km.shared > 0}
								<div class="flex justify-between gap-3">
									<dt class="text-ink-2">
										S kolegou {formatNumber(a.km.shared)} km × {formatNumber(a.rates.shared)} Kč
									</dt>
									<dd>{formatKc(Math.round(a.km.shared * a.rates.shared))}</dd>
								</div>
							{/if}
						{/if}
						{#if a.tickets}
							<div class="flex justify-between gap-3">
								<dt class="text-ink-2">Jízdenky</dt>
								<dd>{formatKc(a.tickets)}</dd>
							</div>
						{/if}
						{#if a.extra}
							<div class="flex justify-between gap-3">
								<dt class="text-ink-2">Parkovné a doklady</dt>
								<dd>{formatKc(a.extra)}</dd>
							</div>
						{/if}
						<div class="flex justify-between gap-3">
							<dt class="text-ink-2">
								Stravné
								<span class="block text-xs text-muted"
									>cesta {formatDuration(a.minutes.driving)} + zápasy {formatDuration(
										a.minutes.games
									)} = {formatDuration(a.minutes.driving + a.minutes.games)}</span
								>
								{#if a.mealNote}<span class="block text-xs text-muted">{a.mealNote}</span>{/if}
							</dt>
							<dd class="whitespace-nowrap">{formatKc(a.meal)}</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-ink-2">
								Všední den
								{#if a.weekdayNote}<span class="block text-xs text-muted">{a.weekdayNote}</span
									>{/if}
							</dt>
							<dd>{formatKc(a.weekday)}</dd>
						</div>
						<div class="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
							<dt>Celkem</dt>
							<dd>{a.estimated ? '≈ ' : ''}{formatKc(a.total)}</dd>
						</div>
					</dl>
					{#each a.notes as n (n)}<p class="mt-2 text-xs text-muted">{n}</p>{/each}
					{#if a.ratesAssumed}
						<p class="mt-2 text-xs text-muted">
							≈ část sazeb je odhad (období bez přehledu odměn).
						</p>
					{/if}
				{:else}
					<p class="mt-2 text-sm text-muted">Zatím nespočítáno. Vyplň trasu a ulož.</p>
				{/if}
			</section>

			{#if legRows.length > 0}
				<section class="rounded-lg border border-line bg-surface p-4">
					<h2 class="text-sm font-semibold">Úseky</h2>
					<ul class="mt-2 space-y-1.5 text-xs">
						{#each legRows as l, i (i)}
							<li class="flex justify-between gap-3">
								<span class="text-ink-2">{l.from} → {l.to}{l.passengers ? ' · s kolegou' : ''}</span
								>
								<span class="shrink-0 tabular-nums"
									>{l.approximate ? '≈ ' : ''}{formatNumber(Math.round(l.meters / 100) / 10)} km · {formatDuration(
										Math.round(l.seconds / 60)
									)}</span
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if data.copySources.length > 0}
				<section class="rounded-lg border border-line bg-surface p-4">
					<h2 class="text-sm font-semibold">Stejně jako jindy</h2>
					<p class="mt-1 text-xs text-muted">Převezme nabírání a vysazování kolegů z jiného dne.</p>
					<form method="POST" action="?/copy" use:enhance={enhanced} class="mt-2 flex gap-2">
						<select
							name="source"
							class="min-w-0 flex-1 rounded-md border-line bg-surface text-xs text-ink"
						>
							{#each data.copySources as c (c.date)}
								<option value={c.date}>{formatDate(c.date)}: {c.label}</option>
							{/each}
						</select>
						<button class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent"
							>Použít</button
						>
					</form>
				</section>
			{/if}

			{#if data.trip}
				<form method="POST" action="?/reset" use:enhance={enhanced}>
					<button class="text-xs text-ink-2 hover:text-danger">Smazat cestu tohoto dne</button>
				</form>
			{/if}
		</aside>
	</div>
</div>
