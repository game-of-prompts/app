import { type Platform } from "./platform";
import { type Game } from "./game";
import { game_detail } from "./store"; // Asumiendo que es una Svelte store o similar
import { fetchGoPGames } from "$lib/ergo/fetch";

/**
 * Carga un juego por su ID, buscándolo primero entre los juegos activos y luego
 * entre los juegos terminados. Actualiza el store game_detail.
 * * @param gameId El ID del juego a cargar.
 * @param platform Una instancia del objeto Platform que implementa
 * fetchGoPGames.
 */
export async function loadGameById(gameId: string, platform: Platform): Promise<void> {
    try {
        // 1. Intentar encontrar el juego
        let gamesMap: Map<string, Game> = await fetchGoPGames();
        let game: Game | undefined = gamesMap.get(gameId);
        
        if (game) {
            console.log(`Juego ${gameId} encontrado.`);
            game_detail.set(game);
            return; // Juego encontrado y store actualizado
        }
        
        // 2. Si no se encuentra en ninguno de los dos listados
        console.log(`Juego ${gameId} no encontrado`);
        // Limpiar el store o establecer un estado de error si es necesario
        // game_detail.set(null); 
        throw new Error(`Juego con ID ${gameId} no encontrado. Es posible que no exista o no esté en las páginas consultadas.`);

    } catch (error) {
        console.error(`Fallo al cargar el juego ${gameId}: ${error instanceof Error ? error.message : String(error)}`);
        // Opcionalmente, limpiar o establecer game_detail a un estado de error o null
        // game_detail.set(null); // O algún indicador de error/vacío
        // Puedes decidir si quieres relanzar el error o manejarlo aquí
        // throw error; 
    }
}