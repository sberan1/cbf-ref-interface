<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const statusLabel: Record<string, string> = {
		pending: 'čeká',
		approved: 'schválen',
		rejected: 'zamítnut'
	};
	const dateTime = new Intl.DateTimeFormat('cs-CZ', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'Europe/Prague'
	});
	const waiting = $derived(
		data.accounts.filter((a) => a.status === 'pending' && a.requested.id !== null).length
	);
</script>

<svelte:head>
	<title>Účty – Rozhodčí ČBF</title>
</svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Účty</h1>
		<p class="mt-1 text-sm text-ink-2">
			{waiting === 0 ? 'Nic nečeká na schválení.' : `Na schválení čeká ${waiting}.`} Schválením se účet
			spáruje s vybraným rozhodčím; jiného rozhodčího zadáš jeho ID.
		</p>
	</div>

	<ul class="space-y-3">
		{#each data.accounts as a (a.id)}
			<li class="rounded-lg border border-line bg-surface p-4">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<div>
						<p class="font-medium">
							{a.name ?? a.email}
							{#if a.role === 'admin'}<span class="ml-1 text-xs text-accent">správce</span>{/if}
						</p>
						<p class="text-xs text-muted">{a.email}</p>
					</div>
					<span
						class={[
							'rounded-full px-2 py-0.5 text-xs font-medium',
							a.status === 'approved'
								? 'bg-accent text-accent-ink'
								: a.status === 'rejected'
									? 'border border-line text-danger'
									: 'border border-line text-ink-2'
						]}>{statusLabel[a.status] ?? a.status}</span
					>
				</div>

				<dl class="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
					<div>
						<dt class="text-xs text-muted">Žádá o spárování s</dt>
						<dd>
							{a.requested.id ? `${a.requested.name} (ID ${a.requested.id})` : '— zatím nevybral'}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-muted">Spárován s</dt>
						<dd>{a.paired.id ? `${a.paired.name} (ID ${a.paired.id})` : '—'}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted">Účet založen / poslední přihlášení</dt>
						<dd class="text-ink-2">
							{dateTime.format(new Date(a.createdAt))} / {dateTime.format(new Date(a.lastLoginAt))}
						</dd>
					</div>
				</dl>

				{#if form?.userId === a.id && form.error}
					<p class="mt-2 text-sm text-danger" role="alert">{form.error}</p>
				{/if}

				{#if a.id !== data.selfId}
					<div class="mt-3 flex flex-wrap items-end gap-2">
						<form method="POST" action="?/approve" use:enhance class="flex items-end gap-2">
							<input type="hidden" name="userId" value={a.id} />
							<label class="text-xs text-muted">
								ID rozhodčího
								<input
									name="officialId"
									inputmode="numeric"
									placeholder={a.requested.id ? String(a.requested.id) : 'ID'}
									class="mt-0.5 block w-28 rounded-md border-line bg-surface py-1 text-sm text-ink"
								/>
							</label>
							<button
								class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
							>
								Schválit
							</button>
						</form>
						{#if a.status !== 'rejected'}
							<form method="POST" action="?/reject" use:enhance>
								<input type="hidden" name="userId" value={a.id} />
								<button
									class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-danger hover:text-danger"
								>
									Zamítnout
								</button>
							</form>
						{/if}
						{#if a.paired.id}
							<form method="POST" action="?/revoke" use:enhance>
								<input type="hidden" name="userId" value={a.id} />
								<button
									class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent"
								>
									Zrušit spárování
								</button>
							</form>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</div>
