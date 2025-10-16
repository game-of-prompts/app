<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { reputation_proof, games } from '$lib/common/store';
	import { get } from 'svelte/store';
	import { total_burned_string, type Judge, type RPBox } from '$lib/ergo/reputation/objects';
	import { GAME, PARTICIPATION, JUDGE } from '$lib/ergo/reputation/types';
	import { judge_detail } from "$lib/common/store";
    import GameCard from './GameCard.svelte';
    import { onDestroy } from 'svelte';
    import Return from './Return.svelte';
    import { update_reputation_proof } from '$lib/ergo/reputation/submit';
    import { json } from '@sveltejs/kit';

	let proof: Judge | undefined = undefined;

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

	let currentOpinion: RPBox | null = get(reputation_proof)?.current_boxes.find(box => box.type.tokenId === JUDGE && proof && box.object_pointer === proof.token_id) || null;
    let newOpinion: string = "";
    let polarization: boolean = true;
	let showOpinionForm: boolean = false;

	$: currentOpinion = get(reputation_proof)?.current_boxes.find(box => box.type.tokenId === JUDGE && proof && box.object_pointer === proof.token_id) || null;

	async function handleOpinionSubmit() {
        if (!proof) return;
        await update_reputation_proof("judge", proof.token_id, polarization, newOpinion);
        newOpinion = "";
    }
</script>

{#if proof}
<Return on:back={handleViewDetails} />
{/if}

<div class="show-judge-container">
	<div class="hero-section text-center">
		<h2 class="project-title">Reputation Proof - Judge</h2>
		{#if proof}
			<p class="subtitle">Details of the selected judge.</p>
		{:else}
			<p class="subtitle">Details of your current judge.</p>
		{/if}
	</div>

	<div class="content-section">
		{#if displayProof}
			<h3 class="section-title">Reputation Proof Details</h3>
			<ul class="proof-details">
				<li><strong>Token ID:</strong> {displayProof.token_id}</li>
				<li><strong>Burned:</strong> {total_burned_string(displayProof)} ERG</li>
				<li><strong>Total Amount:</strong> {displayProof.total_amount}</li>
				<li><strong>Owner Address:</strong> {displayProof.owner_ergotree}</li>
			</ul>

			{#if proof && get(reputation_proof)?.token_id !== proof.token_id}
				{#if currentOpinion}
					<div class="existing-opinion mt-6 p-3 rounded-md border bg-card text-sm">
						<h4 class="font-semibold mb-1">Your existing opinion</h4>
						<p class="mb-1">{typeof currentOpinion.content == "string" ? currentOpinion.content : JSON.stringify(currentOpinion.content)}</p>
						<p class="text-xs text-muted-foreground">
							Polarization: {currentOpinion.polarization ? "Positive" : "Negative"}
						</p>
					</div>
				{:else}
					<div class="opinion-form mt-6 text-sm">
						<button
							class="flex items-center justify-between w-full px-3 py-2 rounded-md border bg-card hover:bg-accent hover:text-accent-foreground transition-colors"
							on:click={() => (showOpinionForm = !showOpinionForm)}
						>
							<span class="font-medium">Give your opinion about this Judge</span>
							<span class="ml-1">{showOpinionForm ? "▲" : "▼"}</span>
						</button>

						{#if showOpinionForm}
							<div class="mt-2 p-3 rounded-md border bg-card space-y-2">
								<textarea
									bind:value={newOpinion}
									placeholder="Optionally, write your opinion..."
									class="w-full border border-input rounded p-2 resize-none focus:ring-1 focus:ring-primary focus:outline-none min-h-[60px] text-sm"
								></textarea>

								<div class="flex items-center gap-4">
									<label class="flex items-center gap-1 cursor-pointer text-sm">
										<input type="radio" bind:group={polarization} value={true} class="accent-green-500" />
										Positive
									</label>
									<label class="flex items-center gap-1 cursor-pointer text-sm">
										<input type="radio" bind:group={polarization} value={false} class="accent-red-500" />
										Negative
									</label>
								</div>

								<Button on:click={handleOpinionSubmit} disabled={!newOpinion.trim()} size="sm">
									Submit
								</Button>
							</div>
						{/if}
					</div>
				{/if}
			{/if}

			{#if displayProof.current_boxes && displayProof.current_boxes.length > 0}
				<h3 class="section-title mt-8">Opinions Issued</h3>
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
								
								<div class="box-content">
									{#if selectedType === GAME}
										{@const game = $games.data.get(box.object_pointer)}
										{#if game}
                                            <GameCard
                                                    game={game}
                                                    index={0}
                                                    opinionContent={JSON.stringify(box.content) || 'No content provided.'}
                                                    isInvited={displayProof && game.judges.includes(displayProof.token_id)}
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
											<span class="info-label">{pointerLabels[selectedType]}: {box.object_pointer.slice(0, 8)}</span>
										</div>
										<p class="box-content-text">{(typeof(box.content) == "string" ? box.content : JSON.stringify(box.content)) || 'No content provided.'}</p>
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
    /* --- Estilos base --- */
    .show-judge-container { max-width: 1400px; margin: 0 auto; padding: 10px 15px 4rem; }
    .project-title { text-align: center; font-size: 2.8rem; font-family: 'Russo One', sans-serif; }
    .subtitle { font-size: 1.1rem; color: hsl(var(--muted-foreground)); margin-top: 0.5rem; margin-bottom: 3rem; }
    
    /* --- Contenedor de contenido principal --- */
    .content-section { 
        @apply p-0;
    }
    .section-title { @apply text-2xl font-semibold mb-4 text-slate-800 dark:text-slate-200 px-2 md:px-0; }
    .proof-details { @apply text-base text-muted-foreground leading-relaxed list-disc pl-6 space-y-3 mb-8 px-2 md:px-0; }

    /* --- Menú de filtros --- */
    .filter-menu { @apply flex items-center justify-center gap-2 md:gap-3 mb-6 flex-wrap px-2 md:px-0; }
    .filter-badge {
        @apply px-4 py-1.5 text-sm font-medium border rounded-full transition-colors duration-200;
        @apply border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground;
    }
    .filter-badge.active {
        @apply bg-primary text-primary-foreground border-transparent hover:bg-primary/90;
        cursor: default;
    }

    /* --- Contenedor de las opiniones --- */
    .boxes-container { 
        @apply flex flex-col border-t border-border;
    }

	/* --- Item de opinión con mejor diferenciación de polarización --- */
	.box-item {
		@apply flex p-4 md:p-6 border-b border-border;
		@apply border-l-4 transition-all duration-300;
		@apply relative;
	}

	/* Polarización positiva - Verde */
	.box-item.positive-opinion {
		border-left-color: #22c55e; /* Verde más vibrante */
		@apply bg-green-50/30 dark:bg-green-950/20;
	}

	.box-item.positive-opinion::before {
		content: "✓";
		@apply absolute -left-2 top-4 w-4 h-4 bg-green-500 text-white text-xs;
		@apply rounded-full flex items-center justify-center font-bold;
	}

	/* Polarización negativa - Rojo */
	.box-item.negative-opinion {
		border-left-color: #ef4444; /* Rojo más vibrante */
		@apply bg-red-50/30 dark:bg-red-950/20;
	}

	.box-item.negative-opinion::before {
		content: "✗";
		@apply absolute -left-2 top-4 w-4 h-4 bg-red-500 text-white text-xs;
		@apply rounded-full flex items-center justify-center font-bold;
	}

	/* Hover effects para mayor interactividad */
	.box-item.positive-opinion:hover {
		@apply bg-green-50/50 dark:bg-green-950/30;
		border-left-width: 6px;
	}

	.box-item.negative-opinion:hover {
		@apply bg-red-50/50 dark:bg-red-950/30;
		border-left-width: 6px;
	}

	/* Mejoras adicionales para el texto de polarización */
	.box-content-text {
		@apply transition-colors duration-300;
	}

	.positive-opinion .box-content-text {
		@apply text-green-700 dark:text-green-300 border-green-300 dark:border-green-700;
	}

	.negative-opinion .box-content-text {
		@apply text-red-700 dark:text-red-300 border-red-300 dark:border-red-700;
	}

	/* Estilos para los detalles de polarización */
	.sub-details-list li strong {
		@apply font-medium;
	}

	.positive-opinion .sub-details-list li:has(strong:contains("Polarization")) {
		@apply text-green-600 dark:text-green-400;
	}

	.negative-opinion .sub-details-list li:has(strong:contains("Polarization")) {
		@apply text-red-600 dark:text-red-400;
	}

	/* Badge de estado opcional */
	.polarization-badge {
		@apply inline-flex items-center px-2 py-1 text-xs font-medium rounded-full;
		@apply absolute top-4 right-4;
	}

	.polarization-badge.positive {
		@apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300;
	}

	.polarization-badge.negative {
		@apply bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300;
	}
</style>