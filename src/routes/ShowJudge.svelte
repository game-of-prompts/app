<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { reputation_proof, games } from "$lib/common/store";
	import { get } from "svelte/store";
	import {
		total_burned_string,
		type ReputationProof,
		type RPBox,
	} from "$lib/ergo/reputation/objects";
	import { GAME, PARTICIPATION, JUDGE } from "$lib/ergo/reputation/types";
	import { judge_detail } from "$lib/common/store";
	import GameCard from "./GameCard.svelte";
	import { onDestroy, onMount } from "svelte";
	import { create_opinion, update_opinion } from "ergo-reputation-system";
	import { explorer_uri } from "$lib/ergo/envs";
	import { Flame, Droplets, Coins, ChevronDown } from "lucide-svelte";
	import { fetch_token_details, type TokenEIP4 } from "$lib/ergo/fetch";
	import { formatTokenBigInt } from "$lib/utils";
	import { mode } from "mode-watcher";

	let proof: ReputationProof | undefined = undefined;

	const unsubscribeDetail = judge_detail.subscribe((value) => {
		proof = value ?? undefined;
	});

	onDestroy(() => {
		unsubscribeDetail();
	});

	function handleViewDetails() {
		if (proof) {
			judge_detail.set(null);
		}
	}

	const OTHER = "other";
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
		[GAME]: "Game",
		[PARTICIPATION]: "Participation",
		[JUDGE]: "Judge",
		[OTHER]: "Object Pointer",
	};

	let currentOpinion: RPBox | null =
		get(reputation_proof)?.current_boxes.find(
			(box) =>
				box.type.tokenId === JUDGE &&
				proof &&
				box.object_pointer === proof.token_id,
		) || null;
	let newOpinion: string = "";
	let polarization: boolean = true;
	let showOpinionForm: boolean = false;

	$: currentOpinion =
		get(reputation_proof)?.current_boxes.find(
			(box) =>
				box.type.tokenId === JUDGE &&
				proof &&
				box.object_pointer === proof.token_id,
		) || null;

	async function handleOpinionSubmit() {
		if (!proof) return;
		const currentUserProof = get(reputation_proof);
		if (!currentUserProof) {
			alert("You need a reputation profile to submit an opinion.");
			return;
		}

		try {
			if (currentOpinion) {
				await update_opinion(
					get(explorer_uri),
					currentOpinion,
					polarization,
					newOpinion,
				);
			} else {
				// Create new opinion
				// We need a main box to spend from. We use the first box of the user's proof.
				// Ideally we should pick a box with sufficient tokens, but for now we assume the first one is valid.
				const mainBox = currentUserProof.current_boxes[0];
				if (!mainBox) {
					alert("No valid reputation box found to create opinion.");
					return;
				}

				await create_opinion(
					get(explorer_uri),
					1, // token_amount
					JUDGE, // type_nft_id
					proof.token_id, // object_pointer
					polarization,
					newOpinion,
					false, // is_locked
					mainBox,
				);
			}
			newOpinion = "";
			showOpinionForm = false;
		} catch (e: any) {
			console.error("Error submitting opinion:", e);
			alert("Failed to submit opinion: " + e.message);
		}
	}

	// --- Burned Assets Logic ---
	let burnedTokens: {
		tokenId: string;
		amount: bigint;
		details?: TokenEIP4;
	}[] = [];
	let burnedERG: string = "0";

	$: if (displayProof) {
		// Calculate total burned ERG
		burnedERG = total_burned_string(displayProof);

		// Aggregate burned tokens
		const tokenMap = new Map<string, bigint>();
		displayProof.current_boxes.forEach((box) => {
			box.box.assets.forEach((asset) => {
				const current = tokenMap.get(asset.tokenId) || 0n;
				tokenMap.set(asset.tokenId, current + BigInt(asset.amount));
			});
		});

		burnedTokens = Array.from(tokenMap.entries())
			.filter(([tokenId]) => tokenId !== displayProof.token_id) // Filter out the proof token itself
			.map(([tokenId, amount]) => ({
				tokenId,
				amount,
			}));

		// Fetch details for tokens
		burnedTokens.forEach(async (token, index) => {
			// Skip if it's one of the known types (Game, Participation, Judge) as they are NFTs usually
			// But a judge might burn them? Assuming we want to show everything for now.
			// Actually, the "types" are NFTs, so we might want to filter them out if they are just markers?
			// The user request implies "sacrificed assets", so any token in the boxes is technically locked/burned.
			const details = await fetch_token_details(token.tokenId);
			burnedTokens[index].details = details;
		});
	}
</script>

<div class="show-judge-container">
	<div class="hero-section text-center mb-12">
		<h2
			class="project-title text-4xl font-extrabold tracking-tight lg:text-5xl mb-4 bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent inline-block"
		>
			Reputation Proof - Judge
		</h2>
		{#if proof}
			<p class="subtitle text-lg text-muted-foreground max-w-2xl mx-auto">
				Details of the selected judge and their sacrifices.
			</p>
		{:else}
			<p class="subtitle text-lg text-muted-foreground max-w-2xl mx-auto">
				Manage your reputation and view your sacrifices.
			</p>
		{/if}
	</div>

	<div class="content-section space-y-12">
		{#if displayProof}
			<!-- Sacrificed Assets Section -->
			<section class="sacrificed-assets">
				<div class="flex items-center gap-3 mb-6">
					<div
						class="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-full"
					>
						<Flame
							class="w-6 h-6 text-orange-600 dark:text-orange-500"
						/>
					</div>
					<h3
						class="text-2xl font-bold text-slate-800 dark:text-slate-200"
					>
						Sacrificed Assets
					</h3>
				</div>

				<div
					class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
				>
					<!-- ERG Card -->
					<div
						class="asset-card bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-950/20 dark:to-red-950/20 border border-orange-200 dark:border-orange-800/50"
					>
						<!-- Liquid Fire Effect -->
						<div class="liquid-fire-container">
							<div class="wave-box"></div>
							<div class="wave-box"></div>
							<div class="wave-box"></div>
						</div>

						<div
							class="relative z-10 flex flex-col h-full min-h-[160px]"
						>
							<div class="flex justify-end items-start mb-6">
								<span
									class="text-[10px] font-bold px-2 py-0.5 bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 rounded-full uppercase tracking-wide border border-orange-200 dark:border-orange-800"
								>
									Burned
								</span>
							</div>
							<div class="space-y-1">
								<p
									class="text-sm text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider text-xs"
								>
									Native Currency
								</p>
								<p
									class="text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tight"
								>
									{burnedERG}
									<span
										class="text-lg font-normal text-slate-500"
										>ERG</span
									>
								</p>
							</div>
						</div>
					</div>

					<!-- Token Cards -->
					{#each burnedTokens as token}
						<div
							class="asset-card bg-card border border-border/50 hover:border-orange-300 dark:hover:border-orange-700 transition-colors"
						>
							<!-- Liquid Fire Effect -->
							<div class="liquid-fire-container">
								<div class="wave-box"></div>
								<div class="wave-box"></div>
								<div class="wave-box"></div>
							</div>

							<div
								class="relative z-10 flex flex-col h-full min-h-[160px]"
							>
								<div class="flex justify-end items-start mb-6">
									<span
										class="text-[10px] font-bold px-2 py-0.5 bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 rounded-full uppercase tracking-wide border border-orange-200 dark:border-orange-800"
									>
										Burned
									</span>
								</div>
								<div class="space-y-1">
									<p
										class="text-sm text-slate-500 dark:text-slate-400 font-medium truncate uppercase tracking-wider text-xs"
										title={token.tokenId}
									>
										{token.details?.name ||
											token.tokenId.slice(0, 8) + "..."}
									</p>
									<p
										class="text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tight"
									>
										{formatTokenBigInt(
											token.amount,
											token.details?.decimals || 0,
										)}
									</p>
									{#if token.details?.description}
										<p
											class="text-xs text-slate-400 mt-1 line-clamp-1"
											title={token.details.description}
										>
											{token.details.description}
										</p>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>

			<div class="border-t border-border my-8"></div>

			<!-- Identifier & Technical Details -->
			<div class="mb-8">
				<div class="flex flex-col items-center justify-center mb-6">
					<span
						class="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1"
						>Judge Token ID</span
					>
					<div
						class="font-mono text-xl md:text-2xl font-medium text-slate-800 dark:text-slate-200"
					>
						{displayProof.token_id.slice(
							0,
							8,
						)}...{displayProof.token_id.slice(-8)}
					</div>
				</div>

				<details class="group p-4 rounded-lg border border-border/50">
					<summary
						class="flex justify-between items-center font-medium cursor-pointer list-none text-slate-700 dark:text-slate-300 select-none"
					>
						<span>Technical Details</span>
						<span
							class="transition-transform duration-200 group-open:rotate-180"
						>
							<ChevronDown class="w-5 h-5" />
						</span>
					</summary>
					<div
						class="grid grid-cols-1 gap-6 mt-4 text-sm border-t border-border/50 pt-4"
					>
						<div class="info-block">
							<span class="info-label">Full Token ID</span>
							<span
								class="info-value font-mono text-xs break-all select-all"
							>
								{displayProof.token_id}
							</span>
						</div>
						<div class="info-block">
							<span class="info-label">Owner Script</span>
							<span
								class="info-value font-mono text-xs break-all select-all"
							>
								{displayProof.owner_ergotree}
							</span>
						</div>
					</div>
				</details>
			</div>

			{#if proof && get(reputation_proof)?.token_id !== proof.token_id}
				{#if currentOpinion}
					<div
						class="existing-opinion mt-6 p-3 rounded-md border bg-card text-sm"
					>
						<h4 class="font-semibold mb-1">
							Your existing opinion
						</h4>
						<p class="mb-1">
							{typeof currentOpinion.content == "string"
								? currentOpinion.content
								: JSON.stringify(currentOpinion.content)}
						</p>
						<p class="text-xs text-muted-foreground">
							Polarization: {currentOpinion.polarization
								? "Positive"
								: "Negative"}
						</p>
					</div>
				{:else}
					<div class="opinion-form mt-6 text-sm">
						<button
							class="flex items-center justify-between w-full px-3 py-2 rounded-md border bg-card hover:bg-accent hover:text-accent-foreground transition-colors"
							on:click={() =>
								(showOpinionForm = !showOpinionForm)}
						>
							<span class="font-medium"
								>Give your opinion about this Judge</span
							>
							<span class="ml-1"
								>{showOpinionForm ? "▲" : "▼"}</span
							>
						</button>

						{#if showOpinionForm}
							<div
								class="mt-2 p-3 rounded-md border bg-card space-y-2"
							>
								<textarea
									bind:value={newOpinion}
									placeholder="Optionally, write your opinion..."
									class="w-full border border-input rounded p-2 resize-none focus:ring-1 focus:ring-primary focus:outline-none min-h-[60px] text-sm"
								></textarea>

								<div class="flex items-center gap-4">
									<label
										class="flex items-center gap-1 cursor-pointer text-sm"
									>
										<input
											type="radio"
											bind:group={polarization}
											value={true}
											class="accent-green-500"
										/>
										Positive
									</label>
									<label
										class="flex items-center gap-1 cursor-pointer text-sm"
									>
										<input
											type="radio"
											bind:group={polarization}
											value={false}
											class="accent-red-500"
										/>
										Negative
									</label>
								</div>

								<Button
									on:click={handleOpinionSubmit}
									disabled={!newOpinion.trim()}
									size="sm"
								>
									Submit
								</Button>
							</div>
						{/if}
					</div>
				{/if}
			{/if}

			{#if displayProof.current_boxes && displayProof.current_boxes.length > 0}
				<h3 class="section-title mt-8">Opinions Issued</h3>
				<div class="filter-menu justify-center">
					<button
						class="filter-badge"
						class:active={selectedType === GAME}
						on:click={() => (selectedType = GAME)}>Games</button
					>
					<button
						class="filter-badge"
						class:active={selectedType === PARTICIPATION}
						on:click={() => (selectedType = PARTICIPATION)}
						>Participations</button
					>
					<button
						class="filter-badge"
						class:active={selectedType === JUDGE}
						on:click={() => (selectedType = JUDGE)}>Judges</button
					>
					<button
						class="filter-badge"
						class:active={selectedType === OTHER}
						on:click={() => (selectedType = OTHER)}>Other</button
					>
				</div>
				{#if filteredBoxes.length > 0}
					<div class="boxes-container">
						{#each filteredBoxes as box (box.box_id)}
							{#if selectedType === GAME}
								{@const game = $games.data.get(
									box.object_pointer,
								)}
								{#if game}
									<div
										class="box-item"
										class:positive-opinion={box.polarization}
										class:negative-opinion={!box.polarization}
									>
										<div class="box-content">
											<GameCard
												{game}
												index={0}
												opinionContent={JSON.stringify(
													box.content,
												) || "No content provided."}
												isInvited={displayProof &&
													game.judges.includes(
														displayProof.token_id,
													)}
											/>
										</div>
									</div>
								{/if}
							{:else}
								<div
									class="box-item"
									class:positive-opinion={box.polarization}
									class:negative-opinion={!box.polarization}
								>
									<div class="box-content">
										{#if selectedType === PARTICIPATION}
											<div class="generic-info">
												<span class="info-label"
													>{pointerLabels[
														selectedType
													]}:</span
												>
												<!-- <a href={`/participation?id=${box.object_pointer}`} class="info-link">{box.object_pointer}</a> -->
												<!-- svelte-ignore a11y-missing-attribute -->
												<a>{box.object_pointer}</a>
											</div>
											<p class="box-content-text">
												{box.content ||
													"No content provided."}
											</p>
										{:else if selectedType === JUDGE}
											<div class="generic-info">
												<span class="info-label"
													>{pointerLabels[
														selectedType
													]}: {box.object_pointer.slice(
														0,
														8,
													)}</span
												>
											</div>
											<p class="box-content-text">
												{(typeof box.content == "string"
													? box.content
													: JSON.stringify(
															box.content,
														)) ||
													"No content provided."}
											</p>
											<ul class="sub-details-list">
												<li>
													<strong
														>Polarization:</strong
													>
													{box.polarization
														? "Positive"
														: "Negative"}
												</li>
											</ul>
										{:else if selectedType === OTHER}
											<div class="generic-info">
												<span class="info-label"
													>Raw Opinion Data</span
												>
											</div>
											<ul
												class="sub-details-list all-data"
											>
												<li>
													<strong
														>{pointerLabels[
															selectedType
														]}:</strong
													>
													{box.object_pointer}
												</li>
												<li>
													<strong
														>Polarization:</strong
													>
													{box.polarization
														? "Positive"
														: "Negative"}
												</li>
												<li>
													<strong>Is Locked:</strong>
													{box.is_locked
														? "Yes"
														: "No"}
												</li>
												<li>
													<strong>Type:</strong>
													{box.type.typeName} ({box
														.type.tokenId})
												</li>
												<li>
													<strong>Token ID:</strong>
													{box.token_id}
												</li>
												<li>
													<strong
														>Token Amount:</strong
													>
													{box.token_amount}
												</li>
												<li>
													<strong>Content:</strong>
													{box.content
														? typeof box.content ===
															"object"
															? JSON.stringify(
																	box.content,
																)
															: box.content
														: "None"}
												</li>
											</ul>
										{/if}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				{:else}
					<p class="text-muted-foreground mt-4 text-center">
						No opinions of this type found.
					</p>
				{/if}
			{/if}
		{:else}
			<div class="no-proof text-center py-12">
				<h3 class="text-2xl font-bold text-red-500 mb-4">
					No Reputation Proof Found
				</h3>
				<p class="mb-4">
					It looks like you haven't registered a reputation proof yet.
				</p>
				<Button size="lg" href="/create-judge"
					>Register as a Judge</Button
				>
			</div>
		{/if}
	</div>
</div>

<style lang="postcss">
	/* --- Estilos base --- */
	.show-judge-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem 15px 4rem;
	}

	/* --- Contenedor de contenido principal --- */
	.content-section {
		@apply p-0;
	}
	.section-title {
		@apply text-2xl font-semibold mb-4 text-slate-800 dark:text-slate-200 px-2 md:px-0;
	}
	.proof-details {
		@apply text-base text-muted-foreground leading-relaxed list-disc pl-6 space-y-3 mb-8 px-2 md:px-0;
	}

	/* --- Asset Cards --- */
	.asset-card {
		@apply rounded-xl p-6 shadow-sm relative overflow-hidden;
	}

	/* --- Liquid Fire Effect --- */
	.liquid-fire-container {
		@apply absolute bottom-0 left-0 w-full h-24 overflow-hidden pointer-events-none;
		z-index: 0;
	}

	.wave-box {
		@apply absolute w-[300%] h-[300%];
		left: -100%;
		bottom: -285%;
		background-color: rgba(239, 68, 68, 0.05);
		border-radius: 45%;
		animation: rotate 12s linear infinite;
	}

	.wave-box:nth-child(2) {
		bottom: -290%;
		background-color: rgba(239, 68, 68, 0.08);
		border-radius: 40% 45% 40% 45% / 40% 40% 45% 45%;
		animation: rotate 18s linear infinite reverse;
	}

	.wave-box:nth-child(3) {
		bottom: -295%;
		background-color: rgba(239, 68, 68, 0.05);
		border-radius: 42% 38% 45% 40% / 40% 45% 40% 38%;
		animation: rotate 25s linear infinite;
	}

	@keyframes rotate {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	/* --- Info Block Styles (Matched to GameDetails) --- */
	.info-block {
		display: flex;
		flex-direction: column;
	}
	.info-label {
		font-size: 0.75rem;
		line-height: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		@apply text-slate-400 mb-1;
	}
	:global(.light) .info-label {
		@apply text-gray-500;
	}

	.info-value {
		font-size: 0.875rem;
		line-height: 1.25rem;
		font-weight: 600;
		@apply text-slate-600 dark:text-slate-300;
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

	.positive-opinion
		.sub-details-list
		li:has(strong:contains("Polarization")) {
		@apply text-green-600 dark:text-green-400;
	}

	.negative-opinion
		.sub-details-list
		li:has(strong:contains("Polarization")) {
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
