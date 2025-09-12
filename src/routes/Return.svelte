<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  function handleViewDetails() {
    dispatch('back');
  }
</script>

<button on:click={handleViewDetails} class="back-button" aria-label="Volver a la página anterior">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10.8284 12.0007L15.7782 16.9504L14.364 18.3646L8 12.0007L14.364 5.63672L15.7782 7.05093L10.8284 12.0007Z"></path>
  </svg>
</button>

<style>
  .back-button {
    position: fixed; /* O 'absolute' si el contenedor padre tiene 'position: relative' */
    top: 12px;
    left: 30px;
    background-color: #f0f0f0;
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    transition: background-color 0.3s ease;
    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    z-index: 1000;
  }

  .back-button:hover {
    background-color: #e0e0e0;
  }

  .back-button svg {
    width: 24px;
    height: 24px;
    color: #333;
  }
</style>