<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { reputation_proof, games } from '$lib/common/store';
	import { get } from 'svelte/store';
	import { total_burned_string, type ReputationProof, type RPBox } from '$lib/ergo/reputation/objects';
	import { GAME, PARTICIPATION, JUDGE } from '$lib/ergo/reputation/types';
	import { judge_detail } from "$lib/common/store";
    import GameCard from './GameCard.svelte';
    import { onDestroy } from 'svelte';
    import Return from './Return.svelte';

	let proof: ReputationProof | undefined = undefined;

	const unsubscribeDetail = judge_detail.subscribe(value => { proof = value ?? undefined });

 	onDestroy(() => {
        unsubscribeDetail();
    });

	function handleViewDetails() {
        if (proof) {
            judge_detail.set(null);
        }
    }


	const OTHER = 'other';
	$: displayProof = proof ?? get(reputation_proof);
	let selectedType: string = GAME;

	$: filteredBoxes =
		displayProof?.current_boxes.filter((box) => {
			if (selectedType === OTHER) {
				return ![GAME, PARTICIPATION, JUDGE].includes(box.type.tokenId);
			}
			return box.type.tokenId === selectedType;
		}) ?? [];

	// Objeto para manejar las etiquetas dinámicas del "object pointer"
	const pointerLabels = {
		[GAME]: 'Game',
		[PARTICIPATION]: 'Participation',
		[JUDGE]: 'Judge',
		[OTHER]: 'Object Pointer'
	};
</script>

{#if proof}
<Return on:back={handleViewDetails} />
{/if}

<div class="show-judge-container">
	<div class="hero-section text-center">
		<h2 class="project-title">Reputation Proof</h2>
		{#if proof}
			<p class="subtitle">Details of the selected reputation proof.</p>
		{:else}
			<p class="subtitle">Details of your reputation proof as a judge.</p>
		{/if}
	</div>

	<div class="content-section">
		{#if displayProof}
			<h3 class="section-title">Reputation Proof Details</h3>
			<ul class="proof-details">
				<li><strong>Token ID:</strong> {displayProof.token_id}</li>
				<li><strong>Burned:</strong> {total_burned_string(displayProof)} ERG</li>
				<li><strong>Total Amount:</strong> {displayProof.total_amount}</li>
				<li><strong>Owner Address:</strong> {displayProof.blake_owner_script}</li>
			</ul>

			{#if displayProof.current_boxes && displayProof.current_boxes.length > 0}
				<h3 class="section-title mt-8">Opinions Issued (Boxes)</h3>
				<div class="filter-menu">
					<button class="filter-badge" class:active={selectedType === GAME} on:click={() => (selectedType = GAME)}>Games</button>
					<button class="filter-badge" class:active={selectedType === PARTICIPATION} on:click={() => (selectedType = PARTICIPATION)}>Participations</button>
					<button class="filter-badge" class:active={selectedType === JUDGE} on:click={() => (selectedType = JUDGE)}>Judges</button>
					<button class="filter-badge" class:active={selectedType === OTHER} on:click={() => (selectedType = OTHER)}>Other</button>
				</div>

				<div class="boxes-container">
					{#if filteredBoxes.length > 0}
						{#each filteredBoxes as box (box.box_id)}
							<div class="box-item" class:positive-opinion={box.polarization} class:negative-opinion={!box.polarization}>
								<div class="polarization-icon">{box.polarization ? '👍' : '👎'}</div>
								
								<div class="box-content">
									{#if selectedType === GAME}
										{@const game = $games.get(box.object_pointer)}
										{#if game}
                                            <GameCard
                                                    game={game}
                                                    index={0}
                                                    opinionContent={box.content || 'No content provided.'}
                                                    isInvited={displayProof && game.invitedJudges.includes(displayProof.token_id)}
                                                />
										{/if}
									
									{:else if selectedType === PARTICIPATION}
										<div class="generic-info">
											<span class="info-label">{pointerLabels[selectedType]}:</span>
											<a href={`/participation?id=${box.object_pointer}`} class="info-link">{box.object_pointer}</a>
										</div>
										<p class="box-content-text">{box.content || 'No content provided.'}</p>

									{:else if selectedType === JUDGE}
										<div class="generic-info">
											<span class="info-label">{pointerLabels[selectedType]}:</span>
											<a href={`/judge?id=${box.object_pointer}`} class="info-link">{box.object_pointer}</a>
										</div>
										<p class="box-content-text">{box.content || 'No content provided.'}</p>
										<ul class="sub-details-list">
											<li><strong>Polarization:</strong> {box.polarization ? 'Positive' : 'Negative'}</li>
										</ul>

									{:else if selectedType === OTHER}
										<div class="generic-info"><span class="info-label">Raw Opinion Data</span></div>
										<ul class="sub-details-list all-data">
											<li><strong>{pointerLabels[selectedType]}:</strong> {box.object_pointer}</li>
											<li><strong>Polarization:</strong> {box.polarization ? 'Positive' : 'Negative'}</li>
											<li><strong>Is Locked:</strong> {box.is_locked ? 'Yes' : 'No'}</li>
											<li><strong>Type:</strong> {box.type.typeName} ({box.type.tokenId})</li>
											<li><strong>Token ID:</strong> {box.token_id}</li>
											<li><strong>Token Amount:</strong> {box.token_amount}</li>
											<li><strong>Content:</strong> {box.content ? (typeof box.content === 'object' ? JSON.stringify(box.content) : box.content) : 'None'}</li>
										</ul>
									{/if}
								</div>
							</div>
						{/each}
					{:else}
						<p class="text-muted-foreground mt-4 text-center">No opinions of this type found.</p>
					{/if}
				</div>
			{/if}
		{:else}
			<div class="no-proof text-center py-12">
				<h3 class="text-2xl font-bold text-red-500 mb-4">No Reputation Proof Found</h3>
				<p class="mb-4">It looks like you haven't registered a reputation proof yet.</p>
				<Button size="lg" href="/create-judge">Register as a Judge</Button>
			</div>
		{/if}
	</div>
</div>

<style lang="postcss">
	/* --- Estilos base (sin cambios) --- */
	.show-judge-container { max-width: 1400px; margin: 0 auto; padding: 10px 15px 4rem; }
	.project-title { text-align: center; font-size: 2.8rem; font-family: 'Russo One', sans-serif; }
	.subtitle { font-size: 1.1rem; color: hsl(var(--muted-foreground)); margin-top: 0.5rem; margin-bottom: 3rem; }
	.content-section { @apply p-6 bg-background/50 backdrop-blur-lg rounded-xl shadow border border-white/10; }
	.section-title { @apply text-xl font-semibold mb-4 text-slate-800 dark:text-slate-200; }
	.proof-details { @apply text-base text-muted-foreground leading-relaxed list-disc pl-6 space-y-3; }
	.filter-menu { @apply flex items-center justify-center gap-3 mb-6; }
	.filter-badge { @apply px-4 py-2 text-sm font-medium border rounded-full transition-colors duration-200 border-white/20 text-slate-400 bg-slate-800/10 hover:bg-slate-700/30 hover:text-slate-200; }
	.filter-badge.active { @apply bg-primary text-primary-foreground border-primary/50 cursor-default; }
	.boxes-container { @apply flex flex-col gap-4; }

	/* --- ESTILOS DE TARJETAS MODIFICADOS Y AMPLIADOS --- */
	.box-item {
		@apply flex items-start gap-4 p-4 bg-slate-800/20 rounded-lg border border-white/10 transition-all duration-300;
		border-left: 4px solid transparent;
	}
	.box-item.positive-opinion { border-left-color: hsl(var(--success, 142 71% 45%)); }
	.box-item.negative-opinion { border-left-color: hsl(var(--destructive, 0 84% 60%)); }
	.polarization-icon { @apply text-2xl pt-1; }
	.box-content { @apply flex-1; }

	/* Estilos para el contenido principal (opinión) */
	.box-content-text {
		@apply text-base text-slate-300 mt-2 italic border-l-2 border-slate-700 pl-3;
	}
	
	/* Estilos para información de Juego */
	.game-info { @apply flex flex-wrap items-center gap-x-4 gap-y-1; }
	.game-title-link { @apply text-lg font-semibold text-primary hover:underline; }
	.badge { @apply text-xs font-semibold px-2.5 py-0.5 rounded-full; }
	.badge.invited { @apply bg-blue-500/20 text-blue-300; }
	.badge.organic { @apply bg-purple-500/20 text-purple-300; }

	/* Estilos para información genérica (Participation, Judge) */
	.generic-info { @apply flex items-center gap-2 text-lg; }
	.info-label { @apply font-semibold text-slate-200; }
	.info-link { @apply font-mono text-sm text-amber-400 hover:underline truncate; }

	/* Estilos para listas de detalles secundarios */
	.sub-details-list { @apply list-disc pl-5 mt-3 space-y-1 text-sm text-slate-400; }
	.sub-details-list li strong { @apply font-medium text-slate-300; }
	
	/* Modificador para la lista de "Other" para que sea más densa */
	.sub-details-list.all-data { @apply font-mono text-xs; }
</style>