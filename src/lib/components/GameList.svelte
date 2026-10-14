<script lang="ts">
	import { formatGameStart } from '#lib/format.ts';

	interface Game {
		id: number;
		startsAt: Date | null;
		scheduledDate: string | null;
		role: 'referee' | 'commissioner';
		roleName: string;
		competitionName: string | null;
		homeTeam: string | null;
		awayTeam: string | null;
		homeScore: number | null;
		awayScore: number | null;
		venue: string | null;
		city: string | null;
		colleagues: string | null;
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
			{#each games as g (`${g.id}:${g.roleName}`)}
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
						</span>
					</div>
					<p class="mt-1 text-sm font-medium">
						{g.homeTeam ?? '?'} – {g.awayTeam ?? '?'}
						{#if g.homeScore !== null && g.awayScore !== null}
							<span class="ml-1 text-ink-2 tabular-nums">{g.homeScore}:{g.awayScore}</span>
						{/if}
					</p>
					<p class="mt-0.5 text-xs text-ink-2">
						{[g.competitionName ?? 'neznámá soutěž', [g.venue, g.city].filter(Boolean).join(', ')]
							.filter(Boolean)
							.join(' · ')}
					</p>
					{#if g.colleagues}
						<p class="mt-0.5 text-xs text-muted">s: {g.colleagues}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
