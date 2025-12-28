<script lang="ts">
	import {
		reputation_proof,
		judge_detail,
		connected,
	} from "$lib/common/store";
	import { get } from "svelte/store";
	import { type ReputationProof, Profile } from "ergo-reputation-system";
	import { onDestroy } from "svelte";
	import { explorer_uri } from "$lib/ergo/envs";
    import { GAME, JUDGE, PARTICIPATION } from "$lib/ergo/reputation/types";

	let proof: ReputationProof | undefined = undefined;

	const unsubscribeDetail = judge_detail.subscribe((value) => {
		proof = value ?? undefined;
	});

	onDestroy(() => {
		unsubscribeDetail();
	});

	$: displayProof = proof ?? get(reputation_proof);
</script>

<div class="show-judge-container">
	{#if displayProof}
		<Profile
			reputationProof={displayProof}
			userProfiles={[]}
			connected={$connected}
			title={proof ? "Judge Details" : "My Reputation"}
			subtitle={proof
				? "Details of the selected judge."
				: "Manage your reputation."}
			explorer_uri={$explorer_uri}
			profile_type_nft_id={JUDGE}
			visibleTokenTypes={[JUDGE, GAME, PARTICIPATION]}
			allowCreateProfile={false}
			allowSacrifice={true}
			showBoxesSection={true}
			showReceivedOpinions={true}
			showProfileSwitcher={false}
			showDidacticInfo={true}
			showFilters={true}
			showTechnicalDetails={true}
			allowSetMainBox={false}
			allowDeleteBox={false}
			allowEditBox={false}
		/>
	{:else}
		<div class="no-proof text-center py-12">
			<h3 class="text-2xl font-bold text-red-500 mb-4">
				No Reputation Proof Found
			</h3>
			<p class="mb-4">
				It looks like you haven't registered a reputation proof yet.
			</p>
			<!-- The Profile component might handle creation if we pass allowCreateProfile, 
                 but if we don't have a proof to pass, we might need to handle it or pass null? 
                 The Profile component props say reputationProof is the object. 
                 If it's null, does it show creation UI? 
                 The docs say "create_profile" function exists. 
                 Let's assume we show a message or maybe the Profile component has a "create" mode if proof is missing?
                 The user's original code had a "Register as a Judge" button.
                 I'll keep the "No proof" message for now as a fallback if Profile doesn't handle null proof.
            -->
			<!-- Actually, let's try to render Profile even if displayProof is null, 
                 maybe it has a creation flow? 
                 But the prop type is `ReputationProof`, not `ReputationProof | null`.
                 So I should probably keep the fallback or check if there's a CreateProfile component.
                 The user's original code had a link to `/create-judge`.
            -->
			<!-- Wait, the original code had:
                 <Button size="lg" href="/create-judge">Register as a Judge</Button>
            -->
			<!-- I will keep the fallback for now. -->
			<a
				href="#"
				on:click|preventDefault={() =>
					(window.location.href = "/create-judge")}
				class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8"
			>
				Register as a Judge
			</a>
		</div>
	{/if}
</div>

<style lang="postcss">
	.show-judge-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem 15px 4rem;
	}
</style>
