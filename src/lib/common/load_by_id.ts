import { type Platform } from "./platform"; // Asegúrate de que tu tipo Platform incluya fetchEndedGoPGames
import { type Game } from "./game";
import { game_detail } from "./store"; // Asumiendo que es una Svelte store o similar

/**
 * Carga un juego por su ID, buscándolo primero entre los juegos activos y luego
 * entre los juegos terminados. Actualiza el store game_detail.
 * * @param gameId El ID del juego a cargar.
 * @param platform Una instancia del objeto Platform que implementa
 * fetchActiveGoPGames y fetchEndedGoPGames.
 */
export async function loadGameById(gameId: string, platform: Platform): Promise<void> {
    try {
        console.log(`Intentando cargar el juego con ID: ${gameId}`);

        // 1. Intentar encontrar el juego en los juegos activos
        console.log("Buscando en juegos activos...");
        let activeGamesMap: Map<string, Game> = await platform.fetchActiveGoPGames();
        let game: Game | undefined = activeGamesMap.get(gameId);
        
        if (game) {
            console.log(`Juego ${gameId} encontrado en juegos activos.`);
            game_detail.set(game);
            return; // Juego encontrado y store actualizado
        }

        // 2. Si no se encuentra en activos, intentar encontrarlo en juegos terminados
        console.log(`Juego ${gameId} no encontrado en juegos activos. Buscando en juegos terminados...`);

        // Nota: Tanto fetchActiveGoPGames como fetchEndedGoPGames probablemente obtienen
        // una página de resultados por defecto (ej. los primeros 10). Si el juego no está
        // en esa primera página, no se encontrará con esta lógica simple.
        // Para una carga robusta de un juego específico por ID, considera que estos métodos
        // en 'platform' puedan tomar el 'gameId' como argumento para una búsqueda más dirigida
        // en la API (ej. filtrando por ID de asset si gameId es un NFT ID).

        let endedGamesMap: Map<string, Game> = await platform.fetchEndedGoPGames();
        game = endedGamesMap.get(gameId);

        if (game) {
            console.log(`Juego ${gameId} encontrado en juegos terminados.`);
            game_detail.set(game);
            return; // Juego encontrado y store actualizado
        }
        
        // 3. Si no se encuentra en ninguno de los dos listados
        console.log(`Juego ${gameId} no encontrado ni en juegos activos ni en terminados.`);
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