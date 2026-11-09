<script lang="ts">
	import { categoryLabel, formatGameStart, formatKc } from '#lib/format.ts';

	interface Game {
		/** a ČBF delegation, or a game entered by hand (PDR 0004) */
		kind?: 'cbf' | 'own';
		id: number;
		startsAt: Date | null;
		scheduledDate: string | null;
		role: 'referee' | 'commissioner';
		roleName: string;
		competitionName: string | null;
		category?: string | null;
		homeTeam: string | null;
		awayTeam: string | null;
		homeScore: number | null;
		awayScore: number | null;
		venue: string | null;
		city: string | null;
		colleagues: string | null;
		/** fee of the delegation (referees only); `estimate` = assumed rate or mapping */
		fee?: { amount: number | null; estimate: boolean; detail: string } | null;
		/** own games: what it was, how many games, the note */
		title?: string;
		games?: number;
		note?: string | null;
	}

	interface Props {
		title: string;
		games: Game[];
		empty: string;
	}

	let { title, games, empty }: Props = $props();
</script>

<section class="rounded-lg border border-line bg-surface">
	<h2 class="border-b border-line px-4 py-3 text-sm font-semibold">{title}</h2>
	{#if games.length === 0}
		<p class="px-4 py-6 text-sm text-muted">{empty}</p>
	{:else}
		<ul class="divide-y divide-line">
			{#each games as g (`${g.kind ?? 'cbf'}:${g.id}:${g.roleName}`)}
				<li class="px-4 py-3">
					<div class="flex items-baseline justify-between gap-3">
						<p class="text-xs text-muted">{formatGameStart(g.startsAt, g.scheduledDate)}</p>
						<span class="flex shrink-0 items-center gap-1.5 text-xs text-ink-2">
							<span
								class={[
									'inline-block size-2 rounded-full',
									g.role === 'referee' ? 'bg-referee' : 'bg-commissioner'
								]}
							></span>
							{g.roleName}
							{#if g.kind === 'own'}
								<span class="rounded bg-page px-1 text-muted">vlastní</span>
							{/if}
							{#if (g.role === 'referee' || g.kind === 'own') && g.fee}
								<span class="text-muted">·</span>
								{#if g.fee.amount === null}
									<span class="text-muted" title={g.fee.detail}
										>{g.kind === 'own' ? 'odměna?' : 'bez sazby'}</span
									>
								{:else}
									<span class="font-medium text-ink tabular-nums" title={g.fee.detail}
										>{g.fee.estimate ? '≈ ' : ''}{formatKc(g.fee.amount)}</span
									>
								{/if}
							{/if}
						</span>
					</div>
					{#if g.kind === 'own'}
						<p class="mt-1 text-sm font-medium">{g.title}</p>
						<p class="mt-0.5 text-xs text-ink-2">
							{[
								g.games && g.games > 1 ? `${g.games} ${g.games <= 4 ? 'zápasy' : 'zápasů'}` : null,
								g.venue,
								g.note
							]
								.filter(Boolean)
								.join(' · ') || 'vlastní zápas'}
						</p>
					{:else}
						<p class="mt-1 text-sm font-medium">
							{g.homeTeam ?? '?'} – {g.awayTeam ?? '?'}
							{#if g.homeScore !== null && g.awayScore !== null}
								<span class="ml-1 text-ink-2 tabular-nums">{g.homeScore}:{g.awayScore}</span>
							{/if}
						</p>
						<p class="mt-0.5 text-xs text-ink-2">
							{[
								g.competitionName ?? 'neznámá soutěž',
								categoryLabel(g.competitionName, g.category),
								[g.venue, g.city].filter(Boolean).join(', ')
							]
								.filter(Boolean)
								.join(' · ')}
						</p>
					{/if}
					{#if g.colleagues}
						<p class="mt-0.5 text-xs text-muted">s: {g.colleagues}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
