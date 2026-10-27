<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		categoryLabel,
		formatDate,
		formatDuration,
		formatKc,
		formatNumber
	} from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Day = (typeof data.days)[number];
	type Line = { key: string; label: string; detail: string | null; amount: number | null };

	const monthName = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' });
	const monthLabel = (m: string) => monthName.format(new Date(`${m}-01T00:00:00Z`));
	const rate = new Intl.NumberFormat('cs-CZ', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});

	/** The rows of a card, in the order they are filled in the payout form. */
	function lines(d: Day): Line[] {
		const out: Line[] = [];
		const many = d.games.length + d.own.length > 1;
		for (const g of d.games) {
			out.push({
				key: `fee-${g.id}`,
				label: many ? `Odměna – ${g.competition ?? g.teams}` : 'Odměna',
				detail: g.fee === null ? (g.feeNote ?? 'bez sazby') : g.estimate ? 'odhad sazby' : null,
				amount: g.fee
			});
		}
		for (const o of d.own) {
			out.push({ key: `own-${o.id}`, label: `Odměna – ${o.title}`, detail: null, amount: o.fee });
		}
		const t = d.trip;
		if (!t) return out;
		if (t.mode === 'car') {
			const parts = [
				t.kmAlone ? `${formatNumber(t.kmAlone)} km × ${rate.format(t.rateAlone)}` : null,
				t.kmShared
					? `${formatNumber(t.kmShared)} km × ${rate.format(t.rateShared)} s kolegou`
					: null
			].filter(Boolean);
			out.push({
				key: 'travel',
				label: 'Cestovné',
				detail: parts.join(' + ') || null,
				amount: t.mileage
			});
		} else if (t.mode === 'public') {
			out.push({ key: 'travel', label: 'Jízdenky', detail: 'veřejná doprava', amount: t.tickets });
		} else {
			out.push({
				key: 'travel',
				label: 'Cestovné',
				detail: t.mode === 'passenger' ? 'spolujezdec, cestovné bere řidič' : 'bez cesty',
				amount: 0
			});
		}
		if (t.extra)
			out.push({
				key: 'extra',
				label: 'Parkovné a jiné',
				detail: 'podle dokladů',
				amount: t.extra
			});
		out.push({
			key: 'meal',
			label: 'Stravné',
			detail: t.mealNote ?? formatDuration(t.minutes),
			amount: t.meal
		});
		out.push({ key: 'weekday', label: 'Všední den', detail: t.weekdayNote, amount: t.weekday });
		return out;
	}

	let copied = $state<string | null>(null);
	async function copy(key: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => {
				if (copied === key) copied = null;
			}, 1500);
		} catch {
			copied = null;
		}
	}

	function summary(d: Day) {
		const head = [
			formatDate(d.date),
			...d.games.map((g) => `${g.teams} (${[g.competition, g.role].filter(Boolean).join(', ')})`),
			...d.own.map((o) => o.title)
		];
		const rows = lines(d).map(
			(l) =>
				`${l.label}: ${l.amount === null ? '—' : formatKc(l.amount)}${l.detail ? ` (${l.detail})` : ''}`
		);
		return [...head, ...rows, `Celkem: ${formatKc(d.total)}`].join('\n');
	}

	const submit = (event: Event) => (event.currentTarget as HTMLSelectElement).form?.requestSubmit();
</script>

<svelte:head>
	<title>Vyúčtování – Rozhodčí ČBF</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Vyúčtování</h1>
			<p class="mt-1 text-sm text-ink-2">
				Co vyplnit za každý den: odměna, cestovné, stravné a všední den.
			</p>
		</div>
		{#if data.months.length > 0}
			<form method="GET" data-sveltekit-noscroll data-sveltekit-keepfocus>
				<label class="grid gap-1 text-xs text-muted">
					Měsíc
					<select
						name="m"
						class="rounded-md border-line bg-surface py-1 text-sm text-ink"
						onchange={submit}
					>
						{#each data.months as m (m)}
							<option value={m} selected={m === data.month}>{monthLabel(m)}</option>
						{/each}
					</select>
				</label>
				<noscript
					><button class="mt-1 rounded-md border border-line px-3 py-1 text-sm">Zobrazit</button
					></noscript
				>
			</form>
		{/if}
	</div>

	{#if data.month === null}
		<p class="text-sm text-muted">Zatím žádné zápasy.</p>
	{:else}
		<p class="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
			<span class="font-semibold">{monthLabel(data.month)}: {formatKc(data.totals.total)}</span>
			<span class="text-ink-2">
				· odměny {formatKc(data.totals.fees)} · náhrady {formatKc(data.totals.allowances)}</span
			>
			{#if data.totals.missingTrips > 0}
				<span class="block text-xs text-ink-2">
					U {data.totals.missingTrips}
					{data.totals.missingTrips === 1 ? 'dne' : 'dnů'} chybí spočítaná cesta, náhrady v součtu nejsou:
					<a class="text-accent hover:underline" href={resolve('/trips')}>Cesty a náhrady</a
					>{data.hasHome ? ' → Spočítat nevyplněné dny.' : ' (nejdřív nastav bydliště v profilu).'}
				</span>
			{/if}
		</p>

		{#each data.days as d (d.date)}
			{@const rows = lines(d)}
			<section class="rounded-lg border border-line bg-surface">
				<div class="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
					<h2 class="text-sm font-semibold">
						{formatDate(d.date)}
						{#if d.upcoming}<span class="ml-1 text-xs font-normal text-muted">nadcházející</span
							>{/if}
					</h2>
					<span class="text-sm font-semibold tabular-nums"
						>{d.trip?.estimated ? '≈ ' : ''}{formatKc(d.total)}</span
					>
				</div>

				<ul class="space-y-1 px-4 pt-3 text-sm">
					{#each d.games as g (g.id)}
						<li>
							<span class="font-medium">{g.teams}</span>
							<span class="text-ink-2">· {g.role}</span>
							<span class="block text-xs text-ink-2"
								>{[g.competition, categoryLabel(g.competition, g.category), g.venue]
									.filter(Boolean)
									.join(' · ')}</span
							>
						</li>
					{/each}
					{#each d.own as o (o.id)}
						<li>
							<span class="font-medium">{o.title}</span>
							<span class="text-ink-2"
								>· {o.role}{o.games > 1 ? ` · ${formatNumber(o.games)} zápasů` : ''} · vlastní</span
							>
						</li>
					{/each}
				</ul>

				<dl class="divide-y divide-line px-4 py-2 text-sm">
					{#each rows as l (l.key)}
						<div class="flex items-center justify-between gap-3 py-1.5">
							<dt class="min-w-0">
								{l.label}
								{#if l.detail}<span class="block text-xs text-muted">{l.detail}</span>{/if}
							</dt>
							<dd class="flex shrink-0 items-center gap-2 tabular-nums">
								{l.amount === null ? '—' : formatKc(l.amount)}
								{#if l.amount}
									<button
										type="button"
										class="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2 hover:border-accent hover:text-ink"
										aria-label={`Kopírovat ${l.label}`}
										onclick={() => copy(`${d.date}-${l.key}`, String(l.amount))}
										>{copied === `${d.date}-${l.key}` ? 'Zkopírováno' : 'Kopírovat'}</button
									>
								{/if}
							</dd>
						</div>
					{/each}
					{#if !d.trip && d.games.length > 0}
						<div class="flex items-center justify-between gap-3 py-1.5">
							<dt>
								Náhrady
								<span class="block text-xs text-muted">cesta zatím není spočítaná</span>
							</dt>
							<dd>
								<a
									class="text-xs text-accent hover:underline"
									href={resolve('/trips/[date]', { date: d.date })}>Spočítat cestu</a
								>
							</dd>
						</div>
					{/if}
					<div class="flex items-center justify-between gap-3 py-2 font-semibold">
						<dt>Celkem</dt>
						<dd class="tabular-nums">{formatKc(d.total)}</dd>
					</div>
				</dl>

				<div class="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-2">
					{#if d.trip}
						<a
							class="rounded-md border border-line px-3 py-1 text-xs hover:border-accent"
							href={resolve('/trips/[date]', { date: d.date })}>Upravit cestu</a
						>
					{/if}
					<button
						type="button"
						class="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink hover:opacity-90"
						onclick={() => copy(`${d.date}-all`, summary(d))}
						>{copied === `${d.date}-all` ? 'Zkopírováno' : 'Kopírovat vše'}</button
					>
				</div>
				{#if d.trip?.estimated}
					<p class="border-t border-line px-4 py-2 text-xs text-muted">
						≈ Část částek je odhad: {d.trip.notes.join(' ') || 'sazby pro toto období odhadujeme.'}
					</p>
				{/if}
			</section>
		{:else}
			<p class="text-sm text-muted">V tomto měsíci žádné zápasy.</p>
		{/each}
	{/if}
</div>
