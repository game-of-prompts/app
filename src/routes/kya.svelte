<script lang="ts">
  import { onMount } from "svelte";
  import { createEventDispatcher } from 'svelte';
  import * as Dialog from "$lib/components/ui/dialog"; 
  import { Button } from "$lib/components/ui/button";   

  export let title: string = 'Know Your Assumptions - Game of Prompts';
  export let closeBtnText: string = 'I understand and I agree';
  
  let showModal = false;
  let isButtonEnabled = false;
  let contentDiv: HTMLDivElement;
  
  const dispatch = createEventDispatcher();

  onMount(() => {
    const alreadyAccepted = localStorage.getItem('acceptedGoPKYA') === 'true';
    showModal = !alreadyAccepted;

    if (showModal) {
      setTimeout(() => {
        if (contentDiv && contentDiv.scrollHeight <= contentDiv.clientHeight) {
          isButtonEnabled = true;
        }
      }, 0);
    }
  });

  function checkScroll(e: Event) {
    const element = e.target as HTMLDivElement;
    if (Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 5) {
      isButtonEnabled = true;
    }
  }

  function handleOpenModal() {
    showModal = true;
    isButtonEnabled = false; 
    setTimeout(() => {
      if (contentDiv && contentDiv.scrollHeight <= contentDiv.clientHeight) {
        isButtonEnabled = true;
      }
    }, 0);
  }

  function handleCloseModal() {
    showModal = false;
    localStorage.setItem('acceptedGoPKYA', 'true'); 
    dispatch('close');
  }

  $: if (!showModal && localStorage.getItem('acceptedGoPKYA') === 'true') {
    dispatch('close');
  }
</script>

<span 
  class="text-gray-500 cursor-pointer hover:underline" 
  on:click={handleOpenModal}
  on:keydown={(e) => e.key === 'Enter' && handleOpenModal()}
  role="button"
  tabindex="0"
>
  KYA (Game of Prompts)
</span>

<Dialog.Root bind:open={showModal}>
  <Dialog.Content class="w-[700px] max-w-[85vw] sm:max-w-[70vw]">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
    </Dialog.Header>

    <div 
      bind:this={contentDiv}
      on:scroll={checkScroll}
      class="max-h-[50vh] overflow-y-auto pr-4 text-sm" 
    >
      <p class="mb-3">This document describes the key assumptions underlying the design, implementation, and operation of the Game of Prompts (GoP) platform. These are beliefs or conditions considered true or expected for the project to function as intended and achieve its objectives.</p>

      <h3 class="font-bold text-md mt-4 mb-2">Fundamental Assumptions</h3>
      <ul class="list-disc ml-6 space-y-2">
        <li>
          <strong>Viability and Functionality of Celaut Services:</strong>
          <ul class="list-circle ml-6 mt-1 space-y-1">
            <li>It is assumed that Celaut technology is mature and robust enough to create, deploy, and run `game-services` and `solver-services` efficiently and in isolation.</li>
            <li>It is assumed that Celaut services can interact with each other as required (a game-service evaluating a solver-service).</li>
            <li>It is assumed that `web-gop.celaut.bee` can function as an effective Celaut-based portal.</li>
          </ul>
        </li>
        <li>
          <strong>Obfuscation and Autonomy of Game Logic:</strong> It is assumed that the internal logic of a `game-service` can be sufficiently "obfuscated and autonomous" to protect it against reverse engineering by solver creators, maintaining the fairness of the challenge.
        </li>
        <li>
          <strong>Quantifiable and Objective Scoring:</strong> It is assumed that all games designed for GoP will have a "quantifiable scoring" system that is not merely binary (solved/unsolved), allowing for a granular ranking of solver performance.
        </li>
        <li>
          <strong>Successful Integration with the Ergo Blockchain:</strong>
          <ul class="list-circle ml-6 mt-1 space-y-1">
            <li>It is assumed that it is feasible and beneficial to integrate GoP with the Ergo blockchain (ERG) for transparent and immutable recording of results and prize management.</li>
            <li>It is assumed that the transaction costs and speed of the Ergo blockchain are suitable for GoP's needs.</li>
          </ul>
        </li>
        <li>
          <strong>Reliable Solver Evaluation Mechanism:</strong> It is assumed that the `game-service` can accurately and securely evaluate a `solver-service` and generate an encrypted code representing performance, the score obtained, and a file with the game moves (logs).
        </li>
        <li>
          <strong>Mitigation of Fraud by Game Creators:</strong> It is assumed that the requirement to disclose game logs and review by judges is a sufficient mechanism to deter or identify dishonest behavior by game creators.
        </li>
        <li>
          <strong>Player Motivation and Incentives (Poker Dynamics):</strong> It is assumed that the "Poker Incentive" mechanic (where players bet on the quality of their score) will motivate players to participate and increase engagement, and that players will understand and actively participate in this system.
        </li>
        <li>
          <strong>Utility and Adoption of the GoP Web Portal:</strong> It is assumed that the "Web GoP" will be an effective and user-friendly central platform for publishing games, downloading services, and facilitating the publication of results.
        </li>
        <li>
          <strong>Technical Capability of Participants:</strong> It is assumed that "Creators" possess the skills to design challenging and quantifiable games as Celaut services, and that "Players" possess the skills to develop competitive `solver-services`.
        </li>
        <li>
          <strong>Security of Sensitive Information:</strong> It is assumed that the "encrypted code representing performance" is sufficiently secure.
        </li>
        <li>
          <strong>Evolution of Celaut Infrastructure:</strong> It is assumed that GoP can operate with current Celaut capabilities, or that desired improvements will be implemented समय पर.
        </li>
        <li>
          <strong>Viability of Celaut for Complex Tasks:</strong> It is assumed that Celaut is suitable for computationally intensive or complex tasks required by some solvers.
        </li>
      </ul>

      <h3 class="font-bold text-md mt-4 mb-2">Assumptions to Validate and Potential Risks</h3>
      <ul class="list-disc ml-6 space-y-2">
        <li>The actual effectiveness of game logic obfuscation against sophisticated reverse-engineering attempts.</li>
        <li>The adoption and real impact of the "Poker Incentive" on participation and competitive dynamics.</li>
        <li>The scalability and costs of Ergo blockchain integration as the platform grows.</li>
        <li>The capacity and willingness of the judging community to review game logs efficiently, fairly, and in a timely manner.</li>
        <li>The overall security of Celaut services and protection against exploitable vulnerabilities.</li>
      </ul>
      
      <p class="font-bold mt-4">By using Game of Prompts, you acknowledge and agree that:</p>
      <ul class="list-disc ml-6 space-y-2">
        <li>You use the platform at your own risk.</li>
        <li>The platform is provided "as is," without warranties of any kind, express or implied, including, but not limited to, warranties of merchantability, fitness for a particular purpose, and non-infringement.</li>
        <li>There is no guarantee against errors, bugs, or the loss of data or digital assets.</li>
        <li>Game creators are responsible for the fairness and proper functioning of their games. Game of Prompts does not exhaustively verify the internal logic of each game.</li>
        <li>You are solely responsible for the security of your keys, wallets, and any digital assets associated with your participation.</li>
        <li>Blockchain interactions are irreversible.</li>
      </ul>

      <p class="italic mt-6">Do you understand and agree to these assumptions and the associated risks of participating in Game of Prompts?</p>
    </div>

    <Dialog.Footer class="mt-4">
      <Button 
        on:click={handleCloseModal} 
        disabled={!isButtonEnabled}
        class="w-full sm:w-auto"
      >
        {closeBtnText}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .list-circle {
    list-style-type: circle;
  }
</style>